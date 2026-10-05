!macro VVToolsRemoveVerb extension
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\${extension}\shell\VVTools"
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $0 HKCU "Software\VVTools\Shell" "Executable"
    ${if} $0 == "$INSTDIR\vvtools.exe"
      DeleteRegKey HKCU "Software\VVTools\Shell"
      DeleteRegKey HKCU "Software\Classes\CLSID\{D8E3EB9A-31F4-4795-AD5E-31FEC06F3AA1}"
      !insertmacro VVToolsRemoveVerb ".jpg"
      !insertmacro VVToolsRemoveVerb ".jpeg"
      !insertmacro VVToolsRemoveVerb ".png"
      !insertmacro VVToolsRemoveVerb ".webp"
      !insertmacro VVToolsRemoveVerb ".mp4"
      !insertmacro VVToolsRemoveVerb ".mov"
      !insertmacro VVToolsRemoveVerb ".mkv"
      !insertmacro VVToolsRemoveVerb ".avi"
      !insertmacro VVToolsRemoveVerb ".webm"
      !insertmacro VVToolsRemoveVerb ".m4v"
      !insertmacro VVToolsRemoveVerb ".mpeg"
      !insertmacro VVToolsRemoveVerb ".mpg"
      !insertmacro VVToolsRemoveVerb ".mp3"
      !insertmacro VVToolsRemoveVerb ".m4a"
      !insertmacro VVToolsRemoveVerb ".aac"
      !insertmacro VVToolsRemoveVerb ".wav"
      !insertmacro VVToolsRemoveVerb ".flac"
      !insertmacro VVToolsRemoveVerb ".ogg"
      !insertmacro VVToolsRemoveVerb ".opus"
      !insertmacro VVToolsRemoveVerb ".wma"
      !insertmacro VVToolsRemoveVerb ".pdf"
      !insertmacro VVToolsRemoveVerb ".ttf"
      !insertmacro VVToolsRemoveVerb ".otf"
      !insertmacro VVToolsRemoveVerb ".woff"
      !insertmacro VVToolsRemoveVerb ".woff2"
      !insertmacro VVToolsRemoveVerb ".ttc"
      !insertmacro VVToolsRemoveVerb ".otc"
    ${endif}
  ${endif}
!macroend
