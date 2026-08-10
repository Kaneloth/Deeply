#!/usr/bin/env bash
# Run once when the Codespace is created (wired via postCreateCommand in
# devcontainer.json). Installs the Android SDK command-line tools only —
# no Android Studio GUI, since Codespaces is headless. Everything after
# this point (building, testing) happens via `./gradlew` and `adb`,
# never through Android Studio's interface.
set -euo pipefail

ANDROID_SDK_ROOT="$HOME/android-sdk"
CMDLINE_TOOLS_VERSION="11076708" # update if Google publishes a newer version
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip"

mkdir -p "$ANDROID_SDK_ROOT/cmdline-tools"
cd /tmp
curl -sSL "$CMDLINE_TOOLS_URL" -o cmdline-tools.zip
unzip -q cmdline-tools.zip -d "$ANDROID_SDK_ROOT/cmdline-tools"
# The zip extracts to a folder literally named "cmdline-tools" — Android's
# tooling specifically expects it renamed to "latest" alongside it.
mv "$ANDROID_SDK_ROOT/cmdline-tools/cmdline-tools" "$ANDROID_SDK_ROOT/cmdline-tools/latest"
rm cmdline-tools.zip

# Persist env vars for every future shell in this Codespace, not just this script.
{
  echo "export ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT"
  echo "export ANDROID_HOME=$ANDROID_SDK_ROOT"
  echo "export PATH=\$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools"
} >> "$HOME/.bashrc"

export ANDROID_SDK_ROOT="$ANDROID_SDK_ROOT"
export ANDROID_HOME="$ANDROID_SDK_ROOT"
export PATH="$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools"

yes | sdkmanager --licenses > /dev/null
yes | sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

echo "Android SDK command-line tools installed at $ANDROID_SDK_ROOT"
echo "Run 'source ~/.bashrc' or open a new terminal for PATH changes to take effect."
