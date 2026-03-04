.PHONY: dev build test migrate start

dev:
	bun --watch src/server.ts

build:
	bun build src/server.ts --outdir ./dist --target bun

test:
	bun test

migrate:
	bun run src/migrate.ts

start:
	bun run src/server.ts
