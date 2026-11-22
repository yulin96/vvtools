cask "vvtools" do
  arch arm: "arm64", intel: "x64"

  version "0.0.25"
  sha256 arm: "b7786886a77c4087aa26ad52c93a355c30953ac93e4b788f5c145b312ba5e1c4",
         intel: "69933e188b1a18704930114b7ffd9c95e75c01632679e0817250cc279d0cd843"

  url "https://github.com/yulin96/vvtools/releases/download/v#{version}/vvtools-#{version}-#{arch}.dmg"
  name "VVTools"
  desc "Cross-platform batch media conversion and compression utility"
  homepage "https://github.com/yulin96/vvtools"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "VVTools.app"

  postflight_steps do
    run "/usr/bin/xattr",
        args: ["-dr", "com.apple.quarantine", "{{appdir}}/VVTools.app"]
  end

  zap trash: "~/Library/Application Support/VVTools"
end
