' Runs run-reddit.bat without flashing a console window (for Task Scheduler).
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("Wscript.Shell").Run """" & dir & "\run-reddit.bat""", 0, False
