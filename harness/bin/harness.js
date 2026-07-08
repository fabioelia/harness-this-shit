#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).catch((e) => {
  console.error(`harness: ${e.message}`);
  process.exit(1);
});
