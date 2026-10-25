; Picked up by electron-builder for the Windows installer.
; Uninstalling removes what Ultima writes to register as a browser (Settings → General → Default browser,
; src/main/defaultbrowser.js). Updates run the old uninstaller too, so they leave it alone.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\UltimaHTML"
    DeleteRegKey HKCU "Software\Clients\StartMenuInternet\UltimaBrowser"
    DeleteRegValue HKCU "Software\RegisteredApplications" "Ultima Browser"
  ${endIf}
!macroend
