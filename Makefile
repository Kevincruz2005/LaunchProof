.PHONY: install check demo

install:
	pnpm install

check:
	pnpm check

demo:
	./scripts/demo.sh
