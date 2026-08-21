#!/usr/bin/env node
import { main } from "../build/cli.js";

process.exitCode = await main(process.argv.slice(2));
