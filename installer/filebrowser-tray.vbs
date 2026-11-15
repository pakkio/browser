' Runs filebrowser-tray.ps1 without flashing a console window.
' Usage: wscript filebrowser-tray.vbs ["folder"]
Dim fso, ps1, args
Set fso = CreateObject("Scripting.FileSystemObject")
ps1 = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "filebrowser-tray.ps1")
args = ""
If WScript.Arguments.Count > 0 Then
    ' "Z:\" would end in \" and escape the closing quote; "Z:\." is the same folder
    Dim dir: dir = WScript.Arguments(0)
    If Right(dir, 1) = "\" Then dir = dir & "."
    args = " -Dir """ & dir & """"
End If
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File """ & ps1 & """" & args, 0, False
