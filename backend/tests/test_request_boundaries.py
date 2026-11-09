import pytest

from app.deps import normalize_base_url
from app.schemas import VideoRequest


def test_normalize_base_url_keeps_v1_once():
    assert normalize_base_url('https://api.example.com') == 'https://api.example.com/v1'
    assert normalize_base_url('api.example.com/v1/chat/completions') == 'https://api.example.com/v1'


def test_video_request_rejects_external_image_urls():
    with pytest.raises(ValueError, match='内联图片'):
        VideoRequest(model='video-model', prompt='test', image='https://cdn.example/image.png')
