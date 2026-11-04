$WshShell = New-Object -ComObject WScript.Shell

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutDesktopPath = Join-Path $desktop "WAEMPRESTIMO.lnk"

$shortcut = $WshShell.CreateShortcut($shortcutDesktopPath)
$shortcut.TargetPath = "C:\Windows\System32\wscript.exe"
$shortcut.Arguments = '"C:\Users\Note.Win11\Desktop\sistema-emprestimos\iniciar_sistema.vbs"'
$shortcut.IconLocation = "C:\Users\Note.Win11\Desktop\sistema-emprestimos\logo.ico, 0"
$shortcut.Description = "WAEMPRESTIMO - Sistema de Gestão de Empréstimos"
$shortcut.WorkingDirectory = "C:\Users\Note.Win11\Desktop\sistema-emprestimos"
$shortcut.Save()

$shortcutLocalPath = "C:\Users\Note.Win11\Desktop\sistema-emprestimos\WAEMPRESTIMO.lnk"
$shortcut2 = $WshShell.CreateShortcut($shortcutLocalPath)
$shortcut2.TargetPath = "C:\Windows\System32\wscript.exe"
$shortcut2.Arguments = '"C:\Users\Note.Win11\Desktop\sistema-emprestimos\iniciar_sistema.vbs"'
$shortcut2.IconLocation = "C:\Users\Note.Win11\Desktop\sistema-emprestimos\logo.ico, 0"
$shortcut2.Description = "WAEMPRESTIMO - Sistema de Gestão de Empréstimos"
$shortcut2.WorkingDirectory = "C:\Users\Note.Win11\Desktop\sistema-emprestimos"
$shortcut2.Save()

Write-Host "Atalhos criados com sucesso!"
