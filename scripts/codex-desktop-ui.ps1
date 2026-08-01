param(
  [ValidateSet('probe', 'focus', 'send')]
  [string]$Mode = 'probe',

  [long]$PreferredHwnd = 0,

  [string]$ExpectedText = '',

  [string]$ExpectedTextBase64 = '',

  [string]$TargetTaskTitle = '',

  [string]$TargetTaskTitleBase64 = '',

  [string]$TargetTaskRuntimeId = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-CodexWhipResult {
  param(
    [bool]$Ok,
    [string]$Code,
    [hashtable]$Data = @{}
  )

  $result = [ordered]@{
    ok = $Ok
    code = $Code
  }

  foreach ($key in $Data.Keys) {
    $result[$key] = $Data[$key]
  }

  $result | ConvertTo-Json -Compress -Depth 4
  exit 0
}

try {
  if (-not [string]::IsNullOrWhiteSpace($ExpectedTextBase64)) {
    $ExpectedText = [Text.Encoding]::UTF8.GetString(
      [Convert]::FromBase64String($ExpectedTextBase64)
    )
  }
  if (-not [string]::IsNullOrWhiteSpace($TargetTaskTitleBase64)) {
    $TargetTaskTitle = [Text.Encoding]::UTF8.GetString(
      [Convert]::FromBase64String($TargetTaskTitleBase64)
    )
  }

  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes

  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace CodexWhip {
  public static class NativeMethods {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
      public uint type;
      public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
      [FieldOffset(0)] public MOUSEINPUT mi;
      [FieldOffset(0)] public KEYBDINPUT ki;
      [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
      public int dx;
      public int dy;
      public uint mouseData;
      public uint dwFlags;
      public uint time;
      public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
      public ushort wVk;
      public ushort wScan;
      public uint dwFlags;
      public uint time;
      public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
      public uint uMsg;
      public ushort wParamL;
      public ushort wParamH;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr SetActiveWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint inputCount, INPUT[] inputs, int inputSize);

    private static INPUT KeyboardInput(ushort virtualKey, ushort scanCode, uint flags) {
      var input = new INPUT();
      input.type = INPUT_KEYBOARD;
      input.U.ki = new KEYBDINPUT {
        wVk = virtualKey,
        wScan = scanCode,
        dwFlags = flags,
        time = 0,
        dwExtraInfo = UIntPtr.Zero
      };
      return input;
    }

    public static bool SendUnicodeTextToWindow(IntPtr expectedForeground, string text) {
      if (GetForegroundWindow() != expectedForeground) return false;
      var inputs = new List<INPUT>();
      foreach (char codeUnit in text) {
        inputs.Add(KeyboardInput(0, codeUnit, KEYEVENTF_UNICODE));
        inputs.Add(KeyboardInput(0, codeUnit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
      }
      if (inputs.Count == 0) return true;
      return SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT))) == inputs.Count;
    }

    public static bool PressEnterToWindow(IntPtr expectedForeground) {
      if (GetForegroundWindow() != expectedForeground) return false;
      var inputs = new[] {
        KeyboardInput(0x0D, 0, 0),
        KeyboardInput(0x0D, 0, KEYEVENTF_KEYUP)
      };
      return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) == inputs.Length;
    }

    public static IntPtr[] GetVisibleTopLevelWindowsForProcess(int processId) {
      var handles = new List<IntPtr>();
      EnumWindows((hWnd, lParam) => {
        uint windowProcessId;
        GetWindowThreadProcessId(hWnd, out windowProcessId);
        if (windowProcessId == (uint)processId && IsWindowVisible(hWnd)) {
          handles.Add(hWnd);
        }
        return true;
      }, IntPtr.Zero);
      return handles.ToArray();
    }
  }
}
'@

  function Find-CodexComposer {
    param([System.Windows.Automation.AutomationElement]$Root)

    $editCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    )
    $edits = $Root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      $editCondition
    )

    for ($index = 0; $index -lt $edits.Count; $index++) {
      $edit = $edits.Item($index)
      $className = $edit.Current.ClassName
      $bounds = $edit.Current.BoundingRectangle

      if (
        $className -like 'ProseMirror*' -and
        -not $edit.Current.IsOffscreen -and
        $edit.Current.IsEnabled -and
        $bounds.Width -gt 20 -and
        $bounds.Height -gt 20
      ) {
        return $edit
      }
    }

    return $null
  }

  function Set-CodexForeground {
    param([long]$Hwnd)

    $target = [IntPtr]$Hwnd
    $foreground = [CodexWhip.NativeMethods]::GetForegroundWindow()
    $currentThread = [CodexWhip.NativeMethods]::GetCurrentThreadId()
    $targetProcessId = 0
    $foregroundProcessId = 0
    $targetThread = [CodexWhip.NativeMethods]::GetWindowThreadProcessId(
      $target,
      [ref]$targetProcessId
    )
    $foregroundThread = if ($foreground -eq [IntPtr]::Zero) {
      0
    } else {
      [CodexWhip.NativeMethods]::GetWindowThreadProcessId(
        $foreground,
        [ref]$foregroundProcessId
      )
    }
    $attachedForeground = $false
    $attachedTarget = $false

    try {
      if ($foregroundThread -gt 0 -and $foregroundThread -ne $currentThread) {
        $attachedForeground = [CodexWhip.NativeMethods]::AttachThreadInput(
          $currentThread,
          $foregroundThread,
          $true
        )
      }
      if ($targetThread -gt 0 -and $targetThread -ne $currentThread) {
        $attachedTarget = [CodexWhip.NativeMethods]::AttachThreadInput(
          $currentThread,
          $targetThread,
          $true
        )
      }

      [void][CodexWhip.NativeMethods]::ShowWindowAsync($target, 9)
      [void][CodexWhip.NativeMethods]::BringWindowToTop($target)
      [void][CodexWhip.NativeMethods]::SetForegroundWindow($target)
      [void][CodexWhip.NativeMethods]::SetActiveWindow($target)
      Start-Sleep -Milliseconds 80
    } finally {
      if ($attachedTarget) {
        [void][CodexWhip.NativeMethods]::AttachThreadInput(
          $currentThread,
          $targetThread,
          $false
        )
      }
      if ($attachedForeground) {
        [void][CodexWhip.NativeMethods]::AttachThreadInput(
          $currentThread,
          $foregroundThread,
          $false
        )
      }
    }

    return ([long][CodexWhip.NativeMethods]::GetForegroundWindow() -eq $Hwnd)
  }

  function Get-ComposerDraftText {
    param([System.Windows.Automation.AutomationElement]$Composer)

    $valuePattern = $null
    if ($Composer.TryGetCurrentPattern(
      [System.Windows.Automation.ValuePattern]::Pattern,
      [ref]$valuePattern
    )) {
      try {
        $currentValue = $valuePattern.Current.Value
        $normalizedValue = $currentValue.Trim()
        if (
          -not [string]::IsNullOrWhiteSpace($normalizedValue) -and
          -not (Test-ComposerPlaceholder -Name $normalizedValue)
        ) {
          return $normalizedValue
        }
      } catch {
        # Chromium can briefly invalidate the pattern while switching tasks.
      }
    }

    $descendants = $Composer.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    $parts = @()
    $composerName = $Composer.Current.Name.Trim()

    for ($index = 0; $index -lt $descendants.Count; $index++) {
      $element = $descendants.Item($index)
      if ($element.Current.ControlType -ne [System.Windows.Automation.ControlType]::Text) {
        continue
      }

      $text = $element.Current.Name
      if ([string]::IsNullOrWhiteSpace($text)) {
        continue
      }

      $trimmed = $text.Trim()
      if ($element.Current.ClassName -eq 'ProseMirror-trailingBreak') {
        continue
      }
      if (-not [string]::IsNullOrWhiteSpace($composerName) -and $trimmed -eq $composerName) {
        continue
      }

      $parts += $trimmed
    }

    return ($parts -join "`n").Trim()
  }

  function Test-ComposerPlaceholder {
    param([string]$Name)

    if ([string]::IsNullOrWhiteSpace($Name)) {
      return $true
    }

    return (
      $Name -match '^Describe your task' -or
      $Name -match '^Message Codex' -or
      $Name -match '^Ask Codex' -or
      $Name -match '^What do you want' -or
      $Name -match '^Work with ChatGPT' -or
      $Name -match '^Work with Codex' -or
      $Name -match '^Send a message' -or
      $Name -match '^描述你的任务' -or
      $Name -match '^与 ChatGPT 协作' -or
      $Name -match '^与 Codex 协作' -or
      $Name -eq '随心输入'
    )
  }

  function Test-SameAutomationElement {
    param(
      [System.Windows.Automation.AutomationElement]$Left,
      [System.Windows.Automation.AutomationElement]$Right
    )

    if ($null -eq $Left -or $null -eq $Right) {
      return $false
    }

    $leftId = $Left.GetRuntimeId()
    $rightId = $Right.GetRuntimeId()
    if ($leftId.Length -ne $rightId.Length) {
      return $false
    }

    for ($index = 0; $index -lt $leftId.Length; $index++) {
      if ($leftId[$index] -ne $rightId[$index]) {
        return $false
      }
    }

    return $true
  }

  function Test-ContainsAutomationElement {
    param(
      [System.Windows.Automation.AutomationElement]$Ancestor,
      [System.Windows.Automation.AutomationElement]$Element
    )

    if ($null -eq $Ancestor -or $null -eq $Element) {
      return $false
    }

    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $current = $Element
    for ($depth = 0; $depth -lt 16 -and $null -ne $current; $depth++) {
      if (Test-SameAutomationElement -Left $Ancestor -Right $current) {
        return $true
      }
      $current = $walker.GetParent($current)
    }

    return $false
  }

  function Get-AutomationRuntimeId {
    param([System.Windows.Automation.AutomationElement]$Element)

    if ($null -eq $Element) {
      return ''
    }

    return (($Element.GetRuntimeId() | ForEach-Object { [string]$_ }) -join '.')
  }

  function Get-VerifiedCodexTarget {
    param(
      [long]$Hwnd,
      [string]$ExpectedComposerRuntimeId = '',
      [switch]$RequireForeground,
      [switch]$RequireFocus
    )

    if (
      $RequireForeground -and
      [long][CodexWhip.NativeMethods]::GetForegroundWindow() -ne $Hwnd
    ) {
      Write-CodexWhipResult $false 'TARGET_WINDOW_NOT_ACTIVE' @{ hwnd = $Hwnd }
    }

    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
    $documentCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Document
    )
    $document = $root.FindFirst(
      [System.Windows.Automation.TreeScope]::Descendants,
      $documentCondition
    )
    if ($null -eq $document -or $document.Current.Name -ne 'Codex') {
      Write-CodexWhipResult $false 'CODEX_MODE_NOT_FOUND' @{ hwnd = $Hwnd }
    }

    $taskIdentity = Find-CodexTaskIdentity -Root $root
    if ($null -eq $taskIdentity) {
      Write-CodexWhipResult $false 'TASK_ID_NOT_FOUND' @{ hwnd = $Hwnd }
    }
    if (
      (-not [string]::IsNullOrWhiteSpace($TargetTaskTitle) -and
        $taskIdentity.Title -ne $TargetTaskTitle) -or
      (-not [string]::IsNullOrWhiteSpace($TargetTaskRuntimeId) -and
        $taskIdentity.RuntimeId -ne $TargetTaskRuntimeId)
    ) {
      Write-CodexWhipResult $false 'TARGET_SESSION_MISMATCH' @{
        hwnd = $Hwnd
        currentTaskTitle = $taskIdentity.Title
        targetTaskTitle = $TargetTaskTitle
      }
    }

    $composer = Find-CodexComposer -Root $document
    if ($null -eq $composer) {
      Write-CodexWhipResult $false 'COMPOSER_NOT_FOUND' @{ hwnd = $Hwnd }
    }
    $composerRuntimeId = Get-AutomationRuntimeId -Element $composer
    if (
      -not [string]::IsNullOrWhiteSpace($ExpectedComposerRuntimeId) -and
      $composerRuntimeId -ne $ExpectedComposerRuntimeId
    ) {
      Write-CodexWhipResult $false 'COMPOSER_CHANGED' @{ hwnd = $Hwnd }
    }

    if ($RequireFocus) {
      $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
      if (-not (Test-ContainsAutomationElement -Ancestor $composer -Element $focused)) {
        Write-CodexWhipResult $false 'FOCUS_FAILED' @{ hwnd = $Hwnd }
      }
    }

    return [pscustomobject]@{
      Root = $root
      Document = $document
      Composer = $composer
      ComposerRuntimeId = $composerRuntimeId
      TaskIdentity = $taskIdentity
    }
  }

  function Set-And-VerifyComposerFocus {
    param(
      [long]$Hwnd,
      [string]$ExpectedComposerRuntimeId
    )

    if (-not (Set-CodexForeground -Hwnd $Hwnd)) {
      Write-CodexWhipResult $false 'TARGET_WINDOW_NOT_ACTIVE' @{ hwnd = $Hwnd }
    }
    $target = Get-VerifiedCodexTarget `
      -Hwnd $Hwnd `
      -ExpectedComposerRuntimeId $ExpectedComposerRuntimeId `
      -RequireForeground
    $target.Composer.SetFocus()
    Start-Sleep -Milliseconds 50
    return Get-VerifiedCodexTarget `
      -Hwnd $Hwnd `
      -ExpectedComposerRuntimeId $ExpectedComposerRuntimeId `
      -RequireForeground `
      -RequireFocus
  }

  function Get-ExactTextElements {
    param(
      [System.Windows.Automation.AutomationElement]$Document,
      [string]$Text
    )

    $textCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Text
    )
    $elements = $Document.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      $textCondition
    )
    $matches = @()
    for ($index = 0; $index -lt $elements.Count; $index++) {
      $element = $elements.Item($index)
      if ($element.Current.Name.Trim() -eq $Text.Trim()) {
        $matches += $element
      }
    }
    return @($matches)
  }

  function Get-RuntimeIdLookup {
    param([object[]]$Elements)

    $lookup = @{}
    foreach ($element in $Elements) {
      $lookup[(Get-AutomationRuntimeId -Element $element)] = $true
    }
    return $lookup
  }

  function Get-NewExactTextElements {
    param(
      [System.Windows.Automation.AutomationElement]$Document,
      [string]$Text,
      [hashtable]$BeforeRuntimeIds
    )

    $newElements = @()
    foreach ($element in @(Get-ExactTextElements -Document $Document -Text $Text)) {
      $runtimeId = Get-AutomationRuntimeId -Element $element
      if (-not $BeforeRuntimeIds.ContainsKey($runtimeId)) {
        $newElements += $element
      }
    }
    return @($newElements)
  }

  function Test-IsSubmittedUserMessage {
    param([System.Windows.Automation.AutomationElement]$TextElement)

    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $current = $TextElement
    $insideThread = $false
    $insideUserBubble = $false
    for ($depth = 0; $depth -lt 16 -and $null -ne $current; $depth++) {
      $className = $current.Current.ClassName
      if ($className -like '*thread-scroll-container*') {
        $insideThread = $true
      }
      if ($className -like '*bg-token-foreground/5*') {
        $insideUserBubble = $true
      }
      $current = $walker.GetParent($current)
    }
    return ($insideThread -and $insideUserBubble)
  }

  function Get-SteerActionsForText {
    param([System.Windows.Automation.AutomationElement]$TextElement)

    $buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button
    )
    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $container = $walker.GetParent($TextElement)

    for ($depth = 0; $depth -lt 10 -and $null -ne $container; $depth++) {
      $bounds = $container.Current.BoundingRectangle
      if ($bounds.Width -gt 0 -and $bounds.Height -gt 0 -and $bounds.Height -le 300) {
        $buttons = $container.FindAll(
          [System.Windows.Automation.TreeScope]::Descendants,
          $buttonCondition
        )
        $actions = @()
        $seen = @{}
        for ($index = 0; $index -lt $buttons.Count; $index++) {
          $button = $buttons.Item($index)
          if (
            $button.Current.IsOffscreen -or
            -not $button.Current.IsEnabled -or
            -not (Test-SteerAction -Button $button)
          ) {
            continue
          }
          $runtimeId = Get-AutomationRuntimeId -Element $button
          if ($seen.ContainsKey($runtimeId)) { continue }
          $invokePattern = $null
          if ($button.TryGetCurrentPattern(
            [System.Windows.Automation.InvokePattern]::Pattern,
            [ref]$invokePattern
          )) {
            $seen[$runtimeId] = $true
            $actions += [pscustomobject]@{
              RuntimeId = $runtimeId
              InvokePattern = $invokePattern
            }
          }
        }
        if ($actions.Count -gt 0) {
          return @($actions)
        }
      }
      $container = $walker.GetParent($container)
    }

    return @()
  }

  function Test-SameCompactContainer {
    param(
      [System.Windows.Automation.AutomationElement]$Left,
      [System.Windows.Automation.AutomationElement]$Right
    )

    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $leftAncestors = @{}
    $current = $Left

    for ($depth = 0; $depth -lt 8 -and $null -ne $current; $depth++) {
      $bounds = $current.Current.BoundingRectangle
      if ($bounds.Width -gt 0 -and $bounds.Height -gt 0 -and $bounds.Height -le 240) {
        $leftAncestors[(Get-AutomationRuntimeId -Element $current)] = $true
      }
      $current = $walker.GetParent($current)
    }

    $current = $Right
    for ($depth = 0; $depth -lt 8 -and $null -ne $current; $depth++) {
      $runtimeId = Get-AutomationRuntimeId -Element $current
      if ($leftAncestors.ContainsKey($runtimeId)) {
        return $true
      }
      $current = $walker.GetParent($current)
    }

    return $false
  }

  function Test-SteerAction {
    param([System.Windows.Automation.AutomationElement]$Button)

    $name = $Button.Current.Name.Trim()
    $className = $Button.Current.ClassName
    return (
      $name -match '(?i)\bsteer\b' -or
      $name -match '引导' -or
      $className -match '(?i)(steer|follow-up|followup)'
    )
  }

  function Find-CodexTaskIdentity {
    param([System.Windows.Automation.AutomationElement]$Root)

    $buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button
    )
    $buttons = $Root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      $buttonCondition
    )

    for ($index = 0; $index -lt $buttons.Count; $index++) {
      $button = $buttons.Item($index)
      $className = $button.Current.ClassName
      $classTokens = @($className -split '\s+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
      $name = $button.Current.Name.Trim()
      $bounds = $button.Current.BoundingRectangle

      if (
        [string]::IsNullOrWhiteSpace($name) -or
        $className -notlike '*sidebar-item*' -or
        $classTokens -notcontains 'bg-token-list-hover-background' -or
        $className -like '*folder-row*' -or
        $bounds.Width -lt 180 -or
        $bounds.Height -lt 20 -or
        $bounds.Height -gt 45
      ) {
        continue
      }

      return [pscustomobject]@{
        Title = $name
        RuntimeId = Get-AutomationRuntimeId -Element $button
      }
    }

    return $null
  }

  function Get-CodexTaskTitleMatchCount {
    param(
      [System.Windows.Automation.AutomationElement]$Root,
      [string]$Title
    )

    if ([string]::IsNullOrWhiteSpace($Title)) {
      return 0
    }

    $buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button
    )
    $buttons = $Root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      $buttonCondition
    )
    $runtimeIds = @{}

    for ($index = 0; $index -lt $buttons.Count; $index++) {
      $button = $buttons.Item($index)
      $className = $button.Current.ClassName
      if (
        $className -notlike '*sidebar-item*' -or
        $className -like '*folder-row*' -or
        $button.Current.Name.Trim() -ne $Title
      ) {
        continue
      }

      $runtimeIds[(Get-AutomationRuntimeId -Element $button)] = $true
    }

    return $runtimeIds.Count
  }

  $processes = @(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue)
  $windows = @()
  foreach ($process in $processes) {
    $handles = [CodexWhip.NativeMethods]::GetVisibleTopLevelWindowsForProcess($process.Id)
    foreach ($windowHandle in $handles) {
      $windows += [pscustomobject]@{
        Process = $process
        Handle = $windowHandle
      }
    }
  }

  if ($windows.Count -eq 0) {
    Write-CodexWhipResult $false 'APP_NOT_RUNNING'
  }

  $documentCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Document
  )
  $candidates = @()
  $codexDocumentCount = 0

  foreach ($window in $windows) {
    $process = $window.Process
    $handle = [IntPtr]$window.Handle
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    $document = $root.FindFirst(
      [System.Windows.Automation.TreeScope]::Descendants,
      $documentCondition
    )

    if ($null -eq $document -or $document.Current.Name -ne 'Codex') {
      continue
    }

    $codexDocumentCount++
    $composer = Find-CodexComposer -Root $document
    if ($null -eq $composer) {
      continue
    }

    $draftText = Get-ComposerDraftText -Composer $composer
    $hasDraft = -not [string]::IsNullOrWhiteSpace($draftText)
    if (-not $hasDraft -and -not (Test-ComposerPlaceholder -Name $composer.Current.Name)) {
      $hasDraft = $true
    }
    $taskIdentity = Find-CodexTaskIdentity -Root $root
    $titleForMatchCount = if (-not [string]::IsNullOrWhiteSpace($TargetTaskTitle)) {
      $TargetTaskTitle
    } elseif ($null -ne $taskIdentity) {
      $taskIdentity.Title
    } else {
      ''
    }

    $candidates += [pscustomobject]@{
      Hwnd = [long]$handle
      ProcessId = [int]$process.Id
      Document = $document
      Composer = $composer
      HasDraft = $hasDraft
      DraftText = $draftText
      TaskTitle = if ($null -eq $taskIdentity) { '' } else { $taskIdentity.Title }
      TaskRuntimeId = if ($null -eq $taskIdentity) { '' } else { $taskIdentity.RuntimeId }
      TaskTitleMatchCount = Get-CodexTaskTitleMatchCount -Root $root -Title $titleForMatchCount
    }
  }

  if ($candidates.Count -eq 0) {
    if ($codexDocumentCount -gt 0) {
      Write-CodexWhipResult $false 'COMPOSER_NOT_FOUND'
    }

    Write-CodexWhipResult $false 'CODEX_MODE_NOT_FOUND'
  }

  $selected = $null
  $foregroundHwnd = [long][CodexWhip.NativeMethods]::GetForegroundWindow()
  $selected = $candidates | Where-Object { $_.Hwnd -eq $foregroundHwnd } | Select-Object -First 1
  $hasTargetIdentity = (
    -not [string]::IsNullOrWhiteSpace($TargetTaskTitle) -or
    -not [string]::IsNullOrWhiteSpace($TargetTaskRuntimeId)
  )

  if (
    $null -eq $selected -and
    $PreferredHwnd -gt 0 -and
    ($Mode -eq 'probe' -or $hasTargetIdentity)
  ) {
    $selected = $candidates | Where-Object { $_.Hwnd -eq $PreferredHwnd } | Select-Object -First 1
  }

  if (
    $null -eq $selected -and
    $candidates.Count -eq 1 -and
    ($Mode -eq 'probe' -or $hasTargetIdentity)
  ) {
    $selected = $candidates[0]
  }

  if ($null -eq $selected) {
    $selectionCode = if (
      $Mode -ne 'probe' -and
      $hasTargetIdentity
    ) {
      'TARGET_WINDOW_NOT_ACTIVE'
    } else {
      'AMBIGUOUS_WINDOWS'
    }
    Write-CodexWhipResult $false $selectionCode @{
      candidateCount = $candidates.Count
    }
  }

  if ($hasTargetIdentity) {
    if (
      [string]::IsNullOrWhiteSpace($selected.TaskTitle) -or
      [string]::IsNullOrWhiteSpace($selected.TaskRuntimeId)
    ) {
      Write-CodexWhipResult $false 'TASK_ID_NOT_FOUND'
    }

    $titleMismatch = (
      -not [string]::IsNullOrWhiteSpace($TargetTaskTitle) -and
      $selected.TaskTitle -ne $TargetTaskTitle
    )
    $runtimeIdMismatch = (
      -not [string]::IsNullOrWhiteSpace($TargetTaskRuntimeId) -and
      $selected.TaskRuntimeId -ne $TargetTaskRuntimeId
    )
    if ($titleMismatch -or $runtimeIdMismatch) {
      Write-CodexWhipResult $false 'TARGET_SESSION_MISMATCH' @{
        currentTaskTitle = $selected.TaskTitle
        targetTaskTitle = $TargetTaskTitle
      }
    }
  }

  if ($Mode -eq 'probe') {
    $valuePattern = $null
    $textPattern = $null
    Write-CodexWhipResult $true 'READY' @{
      hwnd = $selected.Hwnd
      processId = $selected.ProcessId
      hasDraft = $selected.HasDraft
      hasKeyboardFocus = $selected.Composer.Current.HasKeyboardFocus
      supportsValuePattern = $selected.Composer.TryGetCurrentPattern(
        [System.Windows.Automation.ValuePattern]::Pattern,
        [ref]$valuePattern
      )
      supportsTextPattern = $selected.Composer.TryGetCurrentPattern(
        [System.Windows.Automation.TextPattern]::Pattern,
        [ref]$textPattern
      )
      composerName = $selected.Composer.Current.Name
      draftTextLength = $selected.DraftText.Length
      taskTitle = $selected.TaskTitle
      taskRuntimeId = $selected.TaskRuntimeId
      taskTitleMatchCount = $selected.TaskTitleMatchCount
    }
  }

  if ($Mode -eq 'send') {
    if ($selected.HasDraft) {
      Write-CodexWhipResult $false 'DRAFT_PRESENT' @{
        hwnd = $selected.Hwnd
        processId = $selected.ProcessId
      }
    }
    if ([string]::IsNullOrWhiteSpace($ExpectedText)) {
      Write-CodexWhipResult $false 'SUBMIT_TEXT_NOT_FOUND'
    }

    $composerRuntimeId = Get-AutomationRuntimeId -Element $selected.Composer
    $beforeMessageRuntimeIds = Get-RuntimeIdLookup -Elements @(
      Get-ExactTextElements -Document $selected.Document -Text $ExpectedText
    )
    $target = Set-And-VerifyComposerFocus `
      -Hwnd $selected.Hwnd `
      -ExpectedComposerRuntimeId $composerRuntimeId

    $valuePattern = $null
    $valuePatternUsed = $false
    if ($target.Composer.TryGetCurrentPattern(
      [System.Windows.Automation.ValuePattern]::Pattern,
      [ref]$valuePattern
    )) {
      try {
        $target = Get-VerifiedCodexTarget `
          -Hwnd $selected.Hwnd `
          -ExpectedComposerRuntimeId $composerRuntimeId `
          -RequireForeground `
          -RequireFocus
        $valuePattern.SetValue($ExpectedText)
        $valuePatternUsed = $true
      } catch {
        $valuePatternUsed = $false
      }
    }

    if (-not $valuePatternUsed) {
      $target = Get-VerifiedCodexTarget `
        -Hwnd $selected.Hwnd `
        -ExpectedComposerRuntimeId $composerRuntimeId `
        -RequireForeground `
        -RequireFocus
      if (-not [CodexWhip.NativeMethods]::SendUnicodeTextToWindow(
        [IntPtr]$selected.Hwnd,
        $ExpectedText
      )) {
        Write-CodexWhipResult $false 'KEYBOARD_UNAVAILABLE'
      }
    }

    $draftDeadline = [DateTime]::UtcNow.AddMilliseconds(1200)
    do {
      $currentTarget = Get-VerifiedCodexTarget `
        -Hwnd $selected.Hwnd `
        -ExpectedComposerRuntimeId $composerRuntimeId `
        -RequireForeground
      $composer = $currentTarget.Composer
      if ($null -eq $composer) {
        break
      }

      $draftText = Get-ComposerDraftText -Composer $composer
      $hasDraft = -not [string]::IsNullOrWhiteSpace($draftText)
      if (-not $hasDraft -and -not (Test-ComposerPlaceholder -Name $composer.Current.Name)) {
        $hasDraft = $true
      }

      $selected.Composer = $composer
      $selected.DraftText = $draftText
      $selected.HasDraft = $hasDraft
      if ($selected.HasDraft) {
        break
      }

      Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $draftDeadline)

    if (-not $selected.HasDraft) {
      Write-CodexWhipResult $false 'SUBMIT_TEXT_NOT_FOUND'
    }
    if ($selected.DraftText -ne $ExpectedText) {
      Write-CodexWhipResult $false 'DRAFT_CHANGED'
    }

    $target = Get-VerifiedCodexTarget `
      -Hwnd $selected.Hwnd `
      -ExpectedComposerRuntimeId $composerRuntimeId `
      -RequireForeground `
      -RequireFocus
    if (-not [CodexWhip.NativeMethods]::PressEnterToWindow([IntPtr]$selected.Hwnd)) {
      Write-CodexWhipResult $false 'KEYBOARD_UNAVAILABLE'
    }

    $clearDeadline = [DateTime]::UtcNow.AddMilliseconds(1200)
    do {
      $currentTarget = Get-VerifiedCodexTarget `
        -Hwnd $selected.Hwnd `
        -ExpectedComposerRuntimeId $composerRuntimeId `
        -RequireForeground
      $composer = $currentTarget.Composer
      $draftText = Get-ComposerDraftText -Composer $composer
      $hasDraft = -not [string]::IsNullOrWhiteSpace($draftText)
      if (-not $hasDraft -and -not (Test-ComposerPlaceholder -Name $composer.Current.Name)) {
        $hasDraft = $true
      }

      $selected.Composer = $composer
      $selected.DraftText = $draftText
      $selected.HasDraft = $hasDraft
      if (-not $selected.HasDraft) {
        break
      }
      Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $clearDeadline)

    if ($selected.HasDraft) {
      Write-CodexWhipResult $false 'SUBMIT_FAILED' @{
        hwnd = $selected.Hwnd
        processId = $selected.ProcessId
      }
    }

    $deliveryDeadline = [DateTime]::UtcNow.AddMilliseconds(2500)
    $steerInvoked = $false
    do {
      $currentTarget = Get-VerifiedCodexTarget `
        -Hwnd $selected.Hwnd `
        -ExpectedComposerRuntimeId $composerRuntimeId `
        -RequireForeground
      $newMessages = @(
        Get-NewExactTextElements `
          -Document $currentTarget.Document `
          -Text $ExpectedText `
          -BeforeRuntimeIds $beforeMessageRuntimeIds
      )
      $submittedMessages = @(
        $newMessages | Where-Object { Test-IsSubmittedUserMessage -TextElement $_ }
      )

      if ($submittedMessages.Count -gt 1 -or ($newMessages.Count -gt 1 -and -not $steerInvoked)) {
        Write-CodexWhipResult $false 'DELIVERY_AMBIGUOUS' @{
          hwnd = $selected.Hwnd
          processId = $selected.ProcessId
          candidateCount = $newMessages.Count
        }
      }
      if ($submittedMessages.Count -eq 1) {
        Write-CodexWhipResult $true $(if ($steerInvoked) {
          'QUEUED_MESSAGE_STEERED'
        } else {
          'MESSAGE_DELIVERED'
        }) @{
          hwnd = $selected.Hwnd
          processId = $selected.ProcessId
          messageRuntimeId = Get-AutomationRuntimeId -Element $submittedMessages[0]
          inputMethod = if ($valuePatternUsed) { 'ValuePattern' } else { 'SendInput' }
          draftVerification = 'ExactText'
        }
      }

      if (-not $steerInvoked -and $newMessages.Count -eq 1) {
        $steerActions = @(Get-SteerActionsForText -TextElement $newMessages[0])
        if ($steerActions.Count -gt 1) {
          Write-CodexWhipResult $false 'DELIVERY_AMBIGUOUS' @{
            hwnd = $selected.Hwnd
            processId = $selected.ProcessId
            candidateCount = $steerActions.Count
          }
        }
        if ($steerActions.Count -eq 1) {
          $steerActions[0].InvokePattern.Invoke()
          $steerInvoked = $true
        }
      }

      Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deliveryDeadline)

    Write-CodexWhipResult $false $(if ($steerInvoked) {
      'STEER_DELIVERY_UNCONFIRMED'
    } else {
      'DELIVERY_UNCONFIRMED'
    }) @{
      hwnd = $selected.Hwnd
      processId = $selected.ProcessId
    }
  }

  if ($selected.HasDraft) {
    Write-CodexWhipResult $false 'DRAFT_PRESENT' @{
      hwnd = $selected.Hwnd
      processId = $selected.ProcessId
    }
  }

  $handle = [IntPtr]$selected.Hwnd
  Set-CodexForeground -Hwnd $selected.Hwnd
  $selected.Composer.SetFocus()
  Start-Sleep -Milliseconds 80

  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  if (-not (Test-ContainsAutomationElement -Ancestor $selected.Composer -Element $focused)) {
    Write-CodexWhipResult $false 'FOCUS_FAILED' @{
      hwnd = $selected.Hwnd
      processId = $selected.ProcessId
    }
  }

  Write-CodexWhipResult $true 'FOCUSED' @{
    hwnd = $selected.Hwnd
    processId = $selected.ProcessId
    hasDraft = $false
  }
} catch [System.UnauthorizedAccessException] {
  Write-CodexWhipResult $false 'ACCESS_DENIED' @{
    detail = $_.Exception.Message
  }
} catch {
  Write-CodexWhipResult $false 'HELPER_FAILURE' @{
    detail = $_.Exception.Message
  }
}
