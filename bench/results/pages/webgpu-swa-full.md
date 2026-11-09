# Page bench — webgpu-swa-full

- Mode: live
- Commit: `d08e56afe159d793504ea806097228fe3773ac76`
- Started: 2026-11-08T16:44:27.713Z
- Fixtures: 1, samples per fixture: 3

| Page         | First visible text (ms) | Viewport done (ms) | Full page (ms) | Blocks/s | Output chars | Engine |
| ------------ | ----------------------: | -----------------: | -------------: | -------: | -----------: | ------ |
| long-article |                     525 |               5330 |          14626 |      3.1 |         2921 | webgpu |

## Headline numbers (long-article)

Engine: **WebGPU** (8 threads) · mode `live` · commit `d08e56a`

| Metric                                     |  Value |
| ------------------------------------------ | -----: |
| Time to first visible translated paragraph |  0.5 s |
| Full page translated                       | 14.6 s |
| Remaining work after the first paragraph   | 14.1 s |

These are the two numbers to cite from a `live` run. Mock numbers measure the
scheduler, not the model, and must not be presented as translation speed.
