# MirrorCoding image generation requirements for PI-Desktop

This document is the server-side handoff for PI-Desktop image generation. The
desktop application owns account authorization, credential storage, request
binding, cancellation, and local attachment persistence. MirrorCoding owns the
catalog data and the two authenticated image endpoints described below.

## 1. Catalog contract

`GET /api/pi-desktop/catalog` must keep its existing success envelope:

```json
{ "success": true, "data": { "user": {}, "groups": [], "supported_endpoints": {} } }
```

Each model entry may include an `image` object. The object is present only when
the selected group can call the model through an image endpoint:

```json
{
  "id": "gpt-image-1",
  "supported_endpoint_types": ["openai", "image-generation"],
  "image": {
    "generation_path": "/v1/images/generations",
    "reference_path": "/v1/images/edits",
    "sizes": ["1024x1024", "1536x1024", "1024x1536"],
    "qualities": ["low", "medium", "high"],
    "max_count": 4,
    "supports_chat": false
  }
}
```

Required rules:

- `generation_path` is currently `/v1/images/generations`.
- `reference_path` is omitted when references are unsupported; otherwise it is
  `/v1/images/edits` for multipart edit requests or
  `/v1/images/generations` for JSON reference requests.
- `sizes`, `qualities`, and `max_count` describe only values accepted by the
  selected model and group. Omit a field when the upstream does not support it.
- `supports_chat` describes whether the same model/group remains available in
  the chat model menu. It does not grant image access by itself.
- A model must not be advertised as an image model based only on its name.
  Channel capability and the configured upstream adapter must agree.
- The `auto` group must publish the intersection of image capabilities across
  all candidate groups. It must not invent a size, quality, count, or reference
  route.
- Empty image capability must remove the model from the desktop image menu on
  the next successful catalog refresh.

The catalog `supported_endpoints` object must include:

```json
{
  "image-generation": { "path": "/v1/images/generations", "method": "POST" },
  "image-edit": { "path": "/v1/images/edits", "method": "POST" }
}
```

## 2. Authorization and group binding

The existing PI-Desktop authorization middleware must allow `POST` requests to
`/v1/images/generations` and `/v1/images/edits`. The same access token and
`X-Mirrorcoding-Group` header rules used by chat requests apply:

- Validate the Bearer token and account status before routing.
- URL-decode the group header exactly once before selecting a group.
- Reject a model or group that is not in the current account catalog with a
  structured 403 response.
- A 401 must mean that the access token is invalid or expired. A 403 must mean
  that the selected model/group or capability is unavailable.
- Preserve `Retry-After`, request identifiers, and the upstream content type.
- Do not return access or refresh tokens in a catalog, error, or image response.

## 3. Image endpoints

### Text-to-image and JSON reference requests

`POST /v1/images/generations` accepts the OpenAI image request shape. The
desktop sends only the current prompt and explicitly selected options:

```json
{
  "model": "gemini-3-pro-image-preview",
  "prompt": "A red bicycle under cherry blossoms",
  "n": 1,
  "size": "1024x1024",
  "quality": "high",
  "images": [
    { "image_url": "data:image/png;base64,..." }
  ]
}
```

The `images` member is sent only when the catalog declares
`reference_path: /v1/images/generations`. Unknown or unsupported fields must be
rejected or ignored according to the existing image adapter contract; do not
silently map them to another provider's parameters.

### Multipart edit requests

When `reference_path` is `/v1/images/edits`, accept
`multipart/form-data` at `/v1/images/edits`:

- `model`: selected model id
- `prompt`: current prompt
- `n`, `size`, and `quality` only when declared by the catalog
- one or more `image` parts containing the selected reference bytes

The request must support multiple reference images when the upstream adapter
supports them. Do not require the desktop to send an API key or SDK-specific
authentication field.

## 4. Response contract

Return an OpenAI-compatible JSON response. Each output may provide either a
base64 payload or a URL:

```json
{
  "created": 1730000000,
  "data": [
    { "b64_json": "...", "revised_prompt": "..." },
    { "url": "https://...", "revised_prompt": "..." }
  ]
}
```

`b64_json` must be standard base64 without a data-URL prefix. A URL must be
short-lived or otherwise safe to download without forwarding the MirrorCoding
credential. The desktop downloads URL results itself and retains a retryable
pending URL when a download fails.

Errors should use the existing envelope, for example:

```json
{ "error": { "message": "...", "code": "model_or_group_unavailable" } }
```

Do not automatically retry with another model, group, or image endpoint after
the upstream has accepted a generation request.

## 5. Test fixtures for the MirrorCoding team

Provide controlled local fixtures for:

1. GPT Image text-to-image JSON and multipart edits with two reference images.
2. Gemini native image generation with JSON references.
3. Seedream JSON references through the same generations endpoint.
4. `auto` group capability intersection and a Chinese group name.
5. An empty image catalog, a removed group, 401, 403, 429 with
   `Retry-After`, 503, malformed image response, base64 output, and URL output.

The fixtures must assert the decoded group, upstream path, model id, request
body/multipart fields, and that no credential is present in the request body or
response. Formal-domain deployment and paid-provider acceptance are separate
from this handoff.
