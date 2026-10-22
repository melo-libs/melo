# macOS 发布

正式包使用固定自签证书，更新继续交给 electron-updater / Squirrel.Mac。
证书不是 Apple Developer ID，不能替代 notarization；首次下载仍可能需要在 macOS「隐私与安全性」中允许打开。

## 签名材料

默认目录：`~/Library/Application Support/Melo Release Signing/`。

- `melo.keychain-db`：专用 Keychain。
- `password`：Keychain 密码，仅当前用户可读。
- `certificate.p12`：加密的证书和私钥备份。
- `certificate.pem`：公开证书。

固定 SHA-1 fingerprint：`125C912085E6A07277A8F679B26F8628D6826E09`。
后续版本必须使用同一张证书。请另外保管加密的 P12 和密码，不要将它们提交到 Git 或上传为 Release 附件。

换机器时可导入同一份 P12，并设置 `MELO_MAC_SIGNING_KEYCHAIN` 指向专用 Keychain。
`MELO_MAC_SIGNING_PASSWORD_FILE` 可指定密码文件；没有密码文件时，先手动解锁 Keychain。
构建不更改系统信任，临时加入的 Keychain search list 条目会在结束时移除。

## 构建候选包

更新 `package.json` 版本号，并准备 `docs/releases/<版本>.md`，然后运行：

```sh
pnpm run build:mac
```

此命令执行 lint、typecheck、tests，然后只编译一次，在独立临时目录构建，不覆盖开发实例的 `out`。
产物位于 `dist/macos-<版本>/`，含 arm64 / x64 的 DMG、ZIP、blockmap 和更新 feed。
已存在的候选目录不会被覆盖；需要重建时，先保存或移走旧产物。

脚本检查 ZIP 内应用的签名、版本、更新源，逐文件比对编译内容，校验 DMG 和 feed 的大小及 SHA-512，并生成 `verified-release.json`。
正式包在 manifest 中启用 native updates；证书缺失或签名不匹配会终止构建。

CI 和本地无证书检查可用 `pnpm run build:mac:unsigned`。这类包使用 ad-hoc 签名，不启用 native updates，也不能通过正式发布入口上传。

## 验证与上传

用已有的隔离 profile 启动检查，不安装到 Applications：

```sh
node scripts/e2e-packaged-startup.mjs arm64 dist/macos-<版本>/mac-arm64/Melo.app
node scripts/e2e-packaged-startup.mjs x64 dist/macos-<版本>/mac/Melo.app
```

安装测试确认完成后，再运行 `pnpm run deploy:mac`。它重新检查现有候选包，不重新编译，创建 **GitHub Draft Release**，不会直接对用户发布。
上传前确认 PR 已合并、CI 通过，并检查 Draft 的 tag / target 和更新说明，最后手动发布。
DMG、ZIP、blockmap、`latest-mac.yml` 必须来自同一批构建，不要混用不同候选包的 feed。

2.0.1 及以前的 ad-hoc 版本需要手动安装一次新包；从本次固定证书签名的版本开始，后续同证书版本才能通过应用内重启完成更新。
