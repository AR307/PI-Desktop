param([Parameter(Mandatory = $true)][int]$targetProcessId)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FixtureWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int state);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
}
'@

$window = [Diagnostics.Process]::GetProcessById($targetProcessId).MainWindowHandle
if ($window -eq [IntPtr]::Zero) { throw 'E2E main window is unavailable' }
# CDP can interact with a hidden window. Native capture needs a visible fixture.
[void][FixtureWindow]::ShowWindow($window, 5)
[void][FixtureWindow]::SetForegroundWindow($window)
[void][FixtureWindow]::DwmFlush()
if (-not [FixtureWindow]::IsWindowVisible($window)) { throw 'E2E main window is not visible' }
