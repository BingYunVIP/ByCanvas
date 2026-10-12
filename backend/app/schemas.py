"""请求 / 响应模型。"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .protocols.multimodal import normalize_content

CHAT_MODES = ('responses', 'chat_completions', 'messages')


class ChatMessage(BaseModel):
    role: str
    # 纯文本，或 [{type:'text',text}, {type:'image',image:'data:image/png;base64,...'}]。
    # 参考图只收内联 data: 图片，外链一律拒绝（见 protocols/multimodal.py 的说明）。
    content: str | list[dict]

    @field_validator('content')
    @classmethod
    def _normalize_content(cls, value):
        return normalize_content(value)


class ChatRequest(BaseModel):
    mode: str = 'chat_completions'
    model: str
    reasoning_effort: str | None = None
    max_tokens: int = 2048
    messages: list[ChatMessage] = Field(min_length=1)


class ImagePlanRequest(BaseModel):
    mode: Literal['responses', 'chat_completions']
    body: dict


class GenerateRequest(BaseModel):
    model: str
    prompt: str = Field(min_length=1, max_length=32_000)
    size: str = 'auto'
    quality: str = 'auto'
    output_format: str | None = None
    background: str | None = None  # auto / transparent / opaque


class ImageResult(BaseModel):
    """图片以 base64 直接返回给浏览器，服务器不落盘。"""

    b64: str
    mime: str


class UsageReport(BaseModel):
    duration_seconds: float | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_write_tokens: int | None = None
    cache_read_tokens: int | None = None


class ImageResponse(BaseModel):
    images: list[ImageResult]
    usage: UsageReport | None = None
    errors: list[str] = Field(default_factory=list)


class VideoRequest(BaseModel):
    """视频生成请求（上游走 xAI 的异步视频接口，见 routers/videos.py）。"""

    model: str
    prompt: str = Field(min_length=1, max_length=32_000)
    duration: int | None = Field(default=None, ge=1, le=15)   # 秒，xAI 允许 1-15
    resolution: str | None = None    # 480p / 720p / 1080p
    aspect_ratio: str | None = None  # 1:1 / 16:9 / 9:16 ...
    # 图生视频的首帧。只收内联 data: 图片，外链一律拒绝（否则本服务就成了
    # 别人的内网探针）——与 protocols/multimodal.py 对聊天参考图是同一条规则。
    image: str | None = None

    @field_validator('image')
    @classmethod
    def _inline_image(cls, value):
        if value is None or value == '':
            return None
        if not isinstance(value, str) or not value.startswith('data:image/'):
            raise ValueError('视频首帧只支持内联图片（data:image/...;base64,...）。')
        return value


class VideoResult(BaseModel):
    """视频以 base64 直接返回给浏览器，服务器不落盘。"""

    b64: str
    mime: str


class VideoResponse(BaseModel):
    videos: list[VideoResult]
    usage: UsageReport | None = None
    errors: list[str] = Field(default_factory=list)


class ModelInfo(BaseModel):
    id: str
    name: str
    kind: str = 'chat'  # chat | image
    reasoning: bool = False
    reasoningEfforts: list[str] = Field(default_factory=list)
    defaultReasoningEffort: str | None = None
    qualityOptions: list[str] = Field(default_factory=list)
    defaultQuality: str | None = None
    imageParameters: dict[str, dict | bool] = Field(default_factory=dict)
    # 能不能看图：True/False 来自 OpenRouter 的 input_modalities；None = 目录里也没有，未知
    vision: bool | None = None
    # 视频参数（时长 / 清晰度 / 画面比例）。只有视频模型会带，见 model_capabilities.py。
    videoParameters: dict[str, list[str]] = Field(default_factory=dict)
