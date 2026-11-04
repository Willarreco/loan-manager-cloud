Set WshShell = CreateObject("WScript.Shell")
Dim fso
Set fso = CreateObject("Scripting.FileSystemObject")

' Pasta do sistema
appDir = "C:\Users\Note.Win11\Desktop\sistema-emprestimos"
WshShell.CurrentDirectory = appDir

' Garante que o servidor local está rodando em segundo plano (sem janela de terminal)
WshShell.Run "cmd /c netstat -ano | findstr :3000 >nul || start /b npx -y serve -p 3000 """ & appDir & """", 0, True

WScript.Sleep 600

' Abrir como Aplicativo de Janela Única no Chrome ou Edge
chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

If fso.FileExists(chromePath) Then
    WshShell.Run """" & chromePath & """ --app=http://localhost:3000", 1, False
ElseIf fso.FileExists(edgePath) Then
    WshShell.Run """" & edgePath & """ --app=http://localhost:3000", 1, False
Else
    WshShell.Run "http://localhost:3000", 1, False
End If
