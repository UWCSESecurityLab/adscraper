#!/bin/bash
#xvfb-run --server-args="-screen 0 1600x900x24"
node gen/crawler-cli.js "$@"