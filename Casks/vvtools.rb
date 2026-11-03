cask "vvtools" do
  arch arm: "arm64", intel: "x64"

  version "0.0.24"
  sha256 arm: "3a32d37d1cd1b5ad5e69bc6fbe8fe843b94be855b5abbc6e23ac89ffb44c4869",
         intel: "6e543cc860572c9a59c73beecfe65720dd2290f8d627959614254ea322d1253b"

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
