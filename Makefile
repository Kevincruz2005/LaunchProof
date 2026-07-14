.PHONY: install check demo

install:
	pnpm install

check:
	pnpm check

demo:
	powershell -ExecutionPolicy Bypass -File scripts/demo.ps1
