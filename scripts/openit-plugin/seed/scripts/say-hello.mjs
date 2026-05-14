#!/usr/bin/env node
// say-hello.mjs — the simplest possible script.
//
// What this does: prints a greeting with today's date.
// Inputs: none. Side effects: prints to stdout. No writes.
//
// Edit this file to make it do something useful — or delete it.

const today = new Date().toISOString().slice(0, 10);
console.log(`Hello from OpenIT — today is ${today}.`);
