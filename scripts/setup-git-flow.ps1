#Requires -Version 5.1
<#
.SYNOPSIS
  Inicializa branches do Git Flow (main + develop).

.DESCRIPTION
  Cria a branch develop a partir de main e configura upstream remoto.
  Execute após o primeiro push de main.
#>
param(
    [switch]$SkipPush
)

$ErrorActionPreference = "Stop"

$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne "main") {
    Write-Host "Checkout main primeiro (atual: $branch)..." -ForegroundColor Yellow
    git checkout main
}

if (-not (git rev-parse --verify develop 2>$null)) {
    Write-Host "Criando branch develop..." -ForegroundColor Cyan
    git branch develop
} else {
    Write-Host "Branch develop já existe." -ForegroundColor Green
}

if (-not $SkipPush) {
    $remote = git remote get-url origin 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Push develop → origin..." -ForegroundColor Cyan
        git push -u origin develop
    } else {
        Write-Host "Remote origin não configurado. Rode:" -ForegroundColor Yellow
        Write-Host '  git remote add origin https://github.com/Borges360/review-recorder.git'
        Write-Host '  git push -u origin main'
        Write-Host '  git push -u origin develop'
    }
}

Write-Host "`nGit Flow pronto. Branches:" -ForegroundColor Green
git branch -a

Write-Host "`nFluxo:" -ForegroundColor Cyan
Write-Host "  feature/*  → develop"
Write-Host "  release/*  → main + develop"
Write-Host "  hotfix/*   → main + develop"
