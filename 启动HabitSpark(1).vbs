' ==========================================================================
' 启动HabitSpark.vbs
' 静默（不弹出黑框）启动两个后台服务：
'   1. python -m http.server 8001         网页服务
'   2. python webhook_proxy.py            企业微信 Webhook 代理
' 双击本文件即可启动；放入"启动"文件夹后开机自动运行。
' ==========================================================================

Dim shell, workDir, pythonExe

Set shell = CreateObject("WScript.Shell")

' 固定工作目录，避免开机自启动时当前目录不对导致找不到 webhook_proxy.py
workDir = "H:\acfun"

' 使用完整路径的 python.exe（带控制台版本）。
' 之前用 pythonw.exe（无控制台版本）会导致 http.server 模块异常退出，
' 改用 python.exe 但通过下面 shell.Run 的隐藏窗口参数（0）实现同样的静默效果：
' 控制台确实会被创建，但用户看不到窗口，程序运行更稳定。
pythonExe = "C:\Users\bgxhy\AppData\Local\Programs\Python\Python312\python.exe"

' 切到目标目录后再启动，两条命令都用 cmd /c 包一层，方便指定工作目录
' 第二个参数 0 = 隐藏窗口（控制台仍会创建，只是不显示），第三个参数 False = 不等待命令结束（后台常驻）
shell.Run "cmd /c cd /d """ & workDir & """ && """ & pythonExe & """ -m http.server 8001", 0, False
shell.Run "cmd /c cd /d """ & workDir & """ && """ & pythonExe & """ webhook_proxy.py", 0, False

Set shell = Nothing