# Axis AI Merged App — Build Progress

## Goal
One app (org.dimaseinc.axis, "Axis AI") combining Axis 2.0's full native UI + DiMase AI's permissions + auto-update.

## Tasks
- [x] Re-decode axis-2.0.apk with smali disassembly → /tmp/axis-smali/
- [x] Merge manifest: add DiMase AI permissions + REQUEST_INSTALL_PACKAGES
- [x] Update apktool.yml: versionCode 3, versionName 2.0.0
- [x] Add FileProvider path entry for auto-update downloads
- [x] Write UpdateChecker.smali (HTTP check + download + install)
- [x] Patch SplashActivity.smali to call UpdateChecker on startup
- [x] Build APK: apktool b /tmp/merged-app
- [x] Generate signing keystore (dimaseinc-release.jks)
- [x] Sign APK with jarsigner
- [x] Deploy signed APK to server as axis-2.0.apk
- [x] Update worker.js apk-info version to 2.0.0
- [x] Redeploy website Worker

## Status: COMPLETE ✓

## Keystore Info
- File: /home/dimase/dimaseinc-release.jks
- Alias: dimaseinc-release
- Storepass/Keypass: DiMaseInc2026
- KEEP THIS FILE SAFE - needed for all future APK updates
