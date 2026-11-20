' Runs filebrowser-tray.ps1 without flashing a console window.
' Usage: wscript filebrowser-tray.vbs [--help] ["folder"]
Dim fso, ps1, args, first
Set fso = CreateObject("Scripting.FileSystemObject")
ps1 = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "filebrowser-tray.ps1")
args = ""
first = 0
If WScript.Arguments.Count > 0 Then
    If WScript.Arguments(0) = "--help" Then args = " -Help": first = 1
End If
If WScript.Arguments.Count > first Then
    ' "Z:\" would end in \" and escape the closing quote; "Z:\." is the same folder
    Dim dir: dir = WScript.Arguments(first)
    If Right(dir, 1) = "\" Then dir = dir & "."
    args = args & " -Dir """ & dir & """"
End If
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File """ & ps1 & """" & args, 0, False
