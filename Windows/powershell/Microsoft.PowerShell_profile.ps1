### PowerShell template profile 
### Version 1.03 - Tim Sneath <tim@sneath.org>
### From https://gist.github.com/timsneath/19867b12eee7fd5af2ba
###
### This file should be stored in $PROFILE.CurrentUserAllHosts
### If $PROFILE.CurrentUserAllHosts doesn't exist, you can make one with the following:
###    PS> New-Item $PROFILE.CurrentUserAllHosts -ItemType File -Force
### This will create the file and the containing subdirectory if it doesn't already 
###
### As a reminder, to enable unsigned script execution of local scripts on client Windows, 
### you need to run this line (or similar) from an elevated PowerShell prompt:
###   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned
### This is the default policy on Windows Server 2012 R2 and above for server Windows. For 
### more information about execution policies, run Get-Help about_Execution_Policies.


# Import Terminal Icons
Import-Module -Name Terminal-Icons

# Find out if the current user identity is elevated (has admin rights)
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal $identity
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# Useful shortcuts for traversing directories
function cd... { Set-Location ..\.. }
function cd.... { Set-Location ..\..\.. }

# Compute file hashes - useful for checking successful downloads 
function md5 { Get-FileHash -Algorithm MD5 $args }
function sha1 { Get-FileHash -Algorithm SHA1 $args }
function sha256 { Get-FileHash -Algorithm SHA256 $args }

# Quick shortcut to start notepad
function n { notepad $args }

# Drive shortcuts
function HKLM: { Set-Location HKLM: }
function HKCU: { Set-Location HKCU: }
function Env: { Set-Location Env: }

# Creates drive shortcut for Work Folders, if current user account is using it
if (Test-Path "$env:USERPROFILE\Work Folders") {
  New-PSDrive -Name Work -PSProvider FileSystem -Root "$env:USERPROFILE\Work Folders" -Description "Work Folders"
  function Work: { Set-Location Work: }
}

# Set up command prompt and window title. Use UNIX-style convention for identifying 
# whether user is elevated (root) or not. Window title shows current version of PowerShell
# and appends [ADMIN] if appropriate for easy taskbar identification
function prompt { 
  if ($isAdmin) {
      "[" + (Get-Location) + "] # " 
  } else {
      "[" + (Get-Location) + "] $ "
  }
}

$Host.UI.RawUI.WindowTitle = "PowerShell {0}" -f $PSVersionTable.PSVersion.ToString()
if ($isAdmin) {
  $Host.UI.RawUI.WindowTitle += " [ADMIN]"
}

# Does the the rough equivalent of dir /s /b. For example, dirs *.png is dir /s /b *.png
function dirs {
  if ($args.Count -gt 0) {
      Get-ChildItem -Recurse -Include "$args" | Foreach-Object FullName
  } else {
      Get-ChildItem -Recurse | Foreach-Object FullName
  }
}

# Simple function to start a new elevated process.
function admin {
  if ($args.Count -gt 0) {   
      $argList = "& '" + $args + "'"
      Start-Process "$psHome\powershell.exe" -Verb runAs -ArgumentList $argList
  } else {
      Start-Process "$psHome\powershell.exe" -Verb runAs
  }
}

# Set UNIX-like aliases for the admin command, so sudo <command> will run the command
# with elevated rights. 
Set-Alias -Name su -Value admin
Set-Alias -Name sudo -Value admin

# Make it easy to edit this profile once it's installed
function Edit-Profile {
  if ($host.Name -match "ise") {
      $psISE.CurrentPowerShellTab.Files.Add($profile.CurrentUserAllHosts)
  } else {
      notepad $profile.CurrentUserAllHosts
  }
}

# We don't need these any more; they were just temporary variables to get to $isAdmin. 
# Delete them to prevent cluttering up the user profile. 
Remove-Variable identity
Remove-Variable principal

Function Test-CommandExists {
  Param ($command)
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  try { if (Get-Command $command) { RETURN $true } }
  Catch { Write-Host "$command does not exist"; RETURN $false }
  Finally { $ErrorActionPreference = $oldPreference }
} 
#
# Aliases
#
# If your favorite editor is not here, add an elseif and ensure that the directory it is installed in exists in your $env:Path
#
if (Test-CommandExists nvim) {
  $EDITOR='nvim'
} elseif (Test-CommandExists code) {
  $EDITOR='code'
}
Set-Alias -Name vim -Value $EDITOR


function ll { Get-ChildItem -Path $pwd -File }

# Go to projects folder
function p { Set-Location $HOME\p\ }

# Go to my config folder
function config { Set-Location $HOME\Documents\git\ }

# Git add and commit with a custom message
function gcom {
  git add .
  git commit -m "$args"
}

# Git add, commit with a custom message, and push to the remote repository
function lazyg {
  git add -A
  git commit -m "$args"
  git push
}

# Clone a Git repository
function gc {
  git clone "$args"
}

# Git reset
function grh {
  git reset --hard
}

# clear
function clear {
  cls
}

# pnpm aliases
function pnd {
  pnpm dev
}

function pni {
  pnpm install
}

# yarn aliases
function yd {
  yarn dev
}

function yi {
  yarn install
}

# npm aliases
function nrd {
  npm run dev
}

function ni {
  npm install
}

function cna {
  npx create-next-app@latest .
}

function delete-git {
    $gitFolderPath = Join-Path $pwd ".git"

    if (Test-Path $gitFolderPath -PathType Container) {
        Remove-Item -Path $gitFolderPath -Recurse -Force
        Write-Host ".git folder deleted."
    } else {
        Write-Host "No .git folder found in the current directory."
    }
}

function rnm {
    $nodeModulesPath = Join-Path $pwd "node_modules"

    if (Test-Path $nodeModulesPath -PathType Container) {
        Remove-Item -Path $nodeModulesPath -Recurse -Force
        Write-Host "node_modules folder deleted."
    } else {
        Write-Host "No node_modules folder found in the current directory."
    }
}

# for redundancy lol
function dnm {
    $nodeModulesPath = Join-Path $pwd "node_modules"

    if (Test-Path $nodeModulesPath -PathType Container) {
        Remove-Item -Path $nodeModulesPath -Recurse -Force
        Write-Host "node_modules folder deleted."
    } else {
        Write-Host "No node_modules folder found in the current directory."
    }
}

# Get the public IP address using the ifconfig.me service
function Get-PubIP {
  (Invoke-WebRequest http://ifconfig.me/ip ).Content
}

# Display system uptime
function uptime {
  # Windows PowerShell only
  If ($PSVersionTable.PSVersion.Major -eq 5 ) {
      Get-WmiObject win32_operatingsystem |
      Select-Object @{EXPRESSION={ $_.ConverttoDateTime($_.lastbootuptime)}} | Format-Table -HideTableHeaders
  } Else {
      net statistics workstation | Select-String "since" | foreach-object {$_.ToString().Replace('Statistics since ', '')}
  }
}

# Reload the PowerShell profile
function reload-profile {
  & $profile
}

# Find files with a given name in the current directory and its subdirectories
function find-file($name) {
  Get-ChildItem -Recurse -Filter "*${name}*" -ErrorAction SilentlyContinue | ForEach-Object {
      $place_path = $_.directory
      Write-Output "${place_path}\${_}"
  }
}

# Extract a ZIP file to the current directory
function unzip ($file) {
  Write-Output("Extracting", $file, "to", $pwd)
  $fullFile = Get-ChildItem -Path $pwd -Filter .\cove.zip | ForEach-Object { $_.FullName }
  Expand-Archive -Path $fullFile -DestinationPath $pwd
}

# Search for a regex pattern in files within a specified directory or the pipeline input
function grep($regex, $dir) {
  if ( $dir ) {
      Get-ChildItem $dir | select-string $regex
      return
  }
  $input | select-string $regex
}

# Create a file
function touch($file) {
  "" | Out-File $file -Encoding ASCII
}

# Display information about volumes
function df {
  get-volume
}

# Replace text in a file using a sed-like approach
function sed($file, $find, $replace) {
  (Get-Content $file).replace("$find", $replace) | Set-Content $file
}

# Find the location of an executable in the system PATH
function which($name) {
  Get-Command $name | Select-Object -ExpandProperty Definition
}

# Set an environment variable
function export($name, $value) {
  set-item -force -path "env:$name" -value $value;
}

# Stop a process by name
function pkill($name) {
  Get-Process $name -ErrorAction SilentlyContinue | Stop-Process
}

# Get information about a process by name
function pgrep($name) {
  Get-Process $name
}

# Create a New Directory and Move into It:
function mkcd {
  param([string]$name)
  New-Item -ItemType Directory -Name $name
  Set-Location $name
}

# Open a File or Folder in Explorer:
function explore {
  Invoke-Item .
}

# Run Powershell as Administrator:
function admin {
    Start-Process powershell -Verb RunAs
}

# Import the Chocolatey Profile that contains the necessary code to enable
# tab-completions to function for `choco`.
# Be aware that if you are missing these lines from your profile, tab completion
# for `choco` will not function.
# See https://ch0.co/tab-completion for details.
$ChocolateyProfile = "$env:ChocolateyInstall\helpers\chocolateyProfile.psm1"
if (Test-Path($ChocolateyProfile)) {
  Import-Module "$ChocolateyProfile"
}

Invoke-Expression (& { (zoxide init powershell | Out-String) })

## Final Line to set prompt
oh-my-posh init pwsh --config https://raw.githubusercontent.com/JanDeDobbeleer/oh-my-posh/main/themes/cobalt2.omp.json | Invoke-Expression