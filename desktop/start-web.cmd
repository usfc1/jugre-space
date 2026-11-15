@echo off
title JUGRE Web
node "%~dp0web-server.cjs" --open
if errorlevel 1 pause
