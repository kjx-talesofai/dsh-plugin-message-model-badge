<p align="center">
  <img src="assets/icon.svg" alt="dsh-plugin-message-model-badge" height="112"/>
</p>

# dsh-plugin-message-model-badge

See which **provider and model produced a reply** — `deepseek-official/deepseek-flash`, `bailian/qwen3.5-27b` — in the message's own action row. It matters once a Session talks to more than one model, and in subagent Sessions, which run on their own model.

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/kjx-talesofai/dsh-plugin-message-model-badge?label=license&style=flat-square&color=green" alt="license"></a>
  <a href="https://github.com/kjx-talesofai/dsh-plugin-message-model-badge/actions/workflows/ci.yml"><img src="https://github.com/kjx-talesofai/dsh-plugin-message-model-badge/actions/workflows/ci.yml/badge.svg?branch=main&event=push" alt="CI"></a>
  <img src="https://img.shields.io/badge/DSH-0.2.0--rc.1%20%E2%80%93%200.2.x-blueviolet?style=flat-square" alt="DSH >= 0.2.0-rc.1 and < 0.3.0">
</p>

> 消息旁显示产出它的 provider/model

<details>
<summary><b>中文说明（点开）</b></summary>

消息的操作行里（复制、👍👎 那一排）多出一段次要文字，写明这条回复是哪个 provider 的哪个 model 产出的。主会话和子代理会话都有效——子代理跑在自己的会话里，用它自己的模型。

两点需要知道：

- **一个回合只显示一处**：DSH 只在回合收尾的那条助手消息上渲染操作行，所以一个回合里的多条助手消息只有最后一条被标注。
- **只标不猜**：多模型会话里，早于最近 300 条的消息不显示标识，而不是标成最新的模型；单模型会话不受影响，全部正确。

这是个**纯界面插件**：Host 侧只注册一个 session projection，把日志里本来就有的 `message.source` 递给浏览器，不写文件、不加事件类型、不改任何其他插件的数据。客户端不自己折叠会话事件——这是 DSH 的规矩。

</details>

## Install

```text
github:kjx-talesofai/dsh-plugin-message-model-badge#v0.1.0
```

```sh
dsh plugin --profile desktop add github:kjx-talesofai/dsh-plugin-message-model-badge#v0.1.0
```

Then **restart the desktop app**. A local checkout works too, with an absolute path. Upgrading is uninstall-then-install.

Requires **DSH Desktop ≥ 0.2.0-rc.1 and < 0.3.0**.

## Development

```sh
npm test    # node:test — no install needed, and nothing to build
```

The suite drives the projection fold directly and the browser half through the loader shape it ships in. It does **not** cover the harness end — that the projection arrives in a real browser, or how the label looks in the row. That was confirmed by hand on **macOS (Apple Silicon) · DSH Desktop 0.2.0-rc.2**: `bailian/qwen3.5-27b` in a subagent Session, `deepseek-official/deepseek-flash` in a normal one.

## License

[MIT](LICENSE) © 2026 Jiaxin Kou

<p align="center">
  <a href="https://hypersampling.com">
    <img src="https://assets.hypersampling.com/hyper-sampling-2.jpg" alt="hypersampling" height="38"/>
  </a>
</p>

Built by [Jiaxin Kou](https://hypersampling.com) · [GitHub](https://github.com/kjx-talesofai)
