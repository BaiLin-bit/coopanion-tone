' 无窗口运行 Coopanion 腔调补丁。
'
' 为什么用 wscript 包一层：wscript.exe 是 GUI 子系统程序，自己不开控制台；
' 而直接跑 powershell.exe 会先创建控制台窗口（-WindowStyle Hidden 只是让它不可见，
' 任务计划里仍有可能闪一下）。
'
' 参数说明：
'   shell.Run 命令, 0, False
'     0     = 隐藏窗口
'     False = 不等待，启动后立即退出
'
' 路径用相对路径，避开中文目录名在 VBScript 里的编码问题；
' 计划任务的“起始于”必须指向脚本所在目录。

Dim shell, cmd
Set shell = CreateObject("WScript.Shell")
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\coopanion-tone-patch.ps1 -Quiet"
shell.Run cmd, 0, False
