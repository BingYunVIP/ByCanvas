from __future__ import annotations

import os
import pwd
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / 'deploy.sh'


def run_bash(script: str, *, cwd: Path = ROOT) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ['bash', '-c', script],
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
    )


class DeployScriptTests(unittest.TestCase):
    def test_help_is_available_without_root_or_side_effects(self) -> None:
        result = subprocess.run(
            ['bash', str(DEPLOY), 'help'],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('install', result.stdout)
        self.assertIn('rollback', result.stdout)
        self.assertIn('does not install or configure a reverse proxy', result.stdout)

    def test_invalid_options_fail_before_system_changes(self) -> None:
        for args in (
            ['install', '--port', '0'],
            ['install', '--port', '70000'],
            ['install', '--host', 'example.com'],
            ['status', '--port', '7400'],
            ['unknown'],
        ):
            with self.subTest(args=args):
                result = subprocess.run(
                    ['bash', str(DEPLOY), *args],
                    cwd=ROOT,
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertNotEqual(result.returncode, 0)

    def test_legacy_installer_forwards_to_new_help(self) -> None:
        result = subprocess.run(
            ['bash', str(ROOT / 'tools' / 'install_service.sh'), 'help'],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('ByChat_IMG', result.stdout)

    def test_release_links_are_scoped_to_state_directory(self) -> None:
        with tempfile.TemporaryDirectory(prefix='bychat deploy ') as temp:
            state = Path(temp) / '.deploy'
            release = state / 'releases' / '20260921T120000-test'
            release.mkdir(parents=True)
            (release / '.release').write_text('test\n', encoding='utf-8')
            script = f'''
source {shlex_quote(str(DEPLOY))}
STATE_DIR={shlex_quote(str(state))}
set_link current releases/20260921T120000-test
actual="$(current_release)"
[[ "$actual" == {shlex_quote(str(release))} ]]
[[ "$(readlink "$STATE_DIR/current")" == releases/20260921T120000-test ]]
'''
            result = run_bash(script)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_systemd_unit_handles_spaces_unicode_and_special_characters(self) -> None:
        current_user = pwd.getpwuid(os.getuid()).pw_name
        with tempfile.TemporaryDirectory(prefix='ByChat 空格 $%') as temp:
            root = Path(temp)
            state = root / '.deploy'
            release = state / 'releases' / '20260921T120000-test'
            backend = release / 'backend'
            python = backend / '.venv' / 'bin' / 'python'
            python.parent.mkdir(parents=True)
            python.write_text('#!/bin/sh\nexit 0\n', encoding='utf-8')
            python.chmod(0o755)
            (backend / 'serve.py').write_text('pass\n', encoding='utf-8')
            (release / 'frontend').mkdir()
            state.mkdir(exist_ok=True)
            (state / 'project-id').write_text('test-project-id\n', encoding='utf-8')
            unit = root / 'bychat-backend.service'

            script = f'''
source {shlex_quote(str(DEPLOY))}
STATE_DIR={shlex_quote(str(state))}
RUN_USER={shlex_quote(current_user)}
PORT=7400
BIND=::
write_unit {shlex_quote(str(release))} {shlex_quote(str(unit))}
'''
            result = run_bash(script)
            self.assertEqual(result.returncode, 0, result.stderr)
            content = unit.read_text(encoding='utf-8')
            self.assertIn('Restart=always', content)
            self.assertIn('WantedBy=multi-user.target', content)
            self.assertIn('$$%%', content)

            verify = subprocess.run(
                ['systemd-analyze', 'verify', str(unit)],
                text=True,
                capture_output=True,
                check=False,
            )
            if verify.returncode != 0:
                # Restricted CI containers may deny systemd-analyze's user lookup
                # sockets before it can return success. Parser/configuration errors
                # still remain test failures.
                self.assertIn('Operation not permitted', verify.stderr)
                self.assertNotIn('Failed to prepare filename', verify.stderr)
                self.assertNotIn('Unknown key', verify.stderr)
                self.assertNotIn('Failed to parse', verify.stderr)

    def test_documentation_has_no_proxy_or_container_configuration(self) -> None:
        deploy_doc = (ROOT / 'DEPLOY.md').read_text(encoding='utf-8')
        for forbidden in ('proxy_pass', 'certbot', 'server_name', 'listen 443', 'docker compose'):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, deploy_doc.lower())
        self.assertNotIn('/opt/', deploy_doc)
        self.assertFalse((ROOT / 'backend' / 'Dockerfile').exists())

    def test_activation_switches_release_and_records_previous(self) -> None:
        with tempfile.TemporaryDirectory(prefix='bychat activate ') as temp:
            root = Path(temp)
            state = root / '.deploy'
            old = make_release(state, '20260921T120000-old')
            new = make_release(state, '20260921T120100-new')
            (state / 'backups').mkdir()
            (state / 'project-id').write_text('activation-test\n', encoding='utf-8')
            os.symlink(f'releases/{old.name}', state / 'current')
            unit = root / 'bychat-backend.service'
            log = root / 'systemctl.log'

            script = f'''
source {shlex_quote(str(DEPLOY))}
STATE_DIR={shlex_quote(str(state))}
UNIT_FILE={shlex_quote(str(unit))}
RUN_USER={shlex_quote(pwd.getpwuid(os.getuid()).pw_name)}
PORT=7400
BIND=::
systemd-analyze() {{ return 0; }}
systemctl() {{ printf '%s\\n' "$*" >> {shlex_quote(str(log))}; return 0; }}
wait_healthy() {{ return 0; }}
check_assets() {{ return 0; }}
activate_release {shlex_quote(str(new))}
'''
            result = run_bash(script)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(os.readlink(state / 'current'), f'releases/{new.name}')
            self.assertEqual(os.readlink(state / 'previous'), f'releases/{old.name}')
            self.assertTrue((new / '.success').is_file())
            self.assertIn('# ByChatProjectId=activation-test', unit.read_text(encoding='utf-8'))
            self.assertIn('restart bychat-backend.service', log.read_text(encoding='utf-8'))

    def test_failed_activation_restores_unit_and_links(self) -> None:
        with tempfile.TemporaryDirectory(prefix='bychat rollback ') as temp:
            root = Path(temp)
            state = root / '.deploy'
            old = make_release(state, '20260921T120000-old')
            previous = make_release(state, '20260921T115900-previous')
            new = make_release(state, '20260921T120100-new')
            (state / 'backups').mkdir()
            (state / 'project-id').write_text('rollback-test\n', encoding='utf-8')
            os.symlink(f'releases/{old.name}', state / 'current')
            os.symlink(f'releases/{previous.name}', state / 'previous')
            unit = root / 'bychat-backend.service'
            unit.write_text('old unit\n', encoding='utf-8')

            script = f'''
source {shlex_quote(str(DEPLOY))}
STATE_DIR={shlex_quote(str(state))}
UNIT_FILE={shlex_quote(str(unit))}
RUN_USER={shlex_quote(pwd.getpwuid(os.getuid()).pw_name)}
PORT=7400
BIND=::
NEW_RELEASE={shlex_quote(str(new))}
systemd-analyze() {{ return 0; }}
systemctl() {{ return 0; }}
wait_healthy() {{ return 1; }}
check_assets() {{ return 0; }}
trap on_exit EXIT
activate_release {shlex_quote(str(new))}
'''
            result = run_bash(script)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('restoring the previous service', result.stderr)
            self.assertEqual(unit.read_text(encoding='utf-8'), 'old unit\n')
            self.assertEqual(os.readlink(state / 'current'), f'releases/{old.name}')
            self.assertEqual(os.readlink(state / 'previous'), f'releases/{previous.name}')
            self.assertFalse(new.exists())


def shlex_quote(value: str) -> str:
    import shlex

    return shlex.quote(value)


def make_release(state: Path, name: str) -> Path:
    release = state / 'releases' / name
    (release / 'backend' / '.venv' / 'bin').mkdir(parents=True)
    (release / 'frontend').mkdir()
    (release / '.release').write_text(f'{name}\n', encoding='utf-8')
    python = release / 'backend' / '.venv' / 'bin' / 'python'
    python.write_text('#!/bin/sh\nexit 0\n', encoding='utf-8')
    python.chmod(0o755)
    (release / 'backend' / 'serve.py').write_text('pass\n', encoding='utf-8')
    return release


if __name__ == '__main__':
    unittest.main()
