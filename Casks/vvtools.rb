cask "vvtools" do
  arch arm: "arm64", intel: "x64"

  version :latest
  sha256 :no_check

  url "https://github.com/yulin96/vvtools/releases/latest/download/vvtools-latest-#{arch}.dmg",
      verified: "github.com/yulin96/vvtools/"
  name "VVTools"
  desc "Cross-platform batch media conversion and compression utility"
  homepage "https://github.com/yulin96/vvtools"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true

  app "VVTools.app"

  postflight_steps do
    run "/usr/bin/xattr",
        args: ["-dr", "com.apple.quarantine", "{{appdir}}/VVTools.app"],
        must_succeed: true
  end

  zap trash: "~/Library/Application Support/VVTools"
end
