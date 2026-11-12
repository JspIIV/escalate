"""Builds index.html: a light ledger design of its own, with this page's body and script.

    python docs/build_page.py
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
src = open(os.path.join(HERE, "design.css"), encoding="utf-8").read()
body = open(os.path.join(HERE, "page_body.html"), encoding="utf-8").read()
script = open(os.path.join(HERE, "page_script.html"), encoding="utf-8").read()
dep = json.load(open(os.path.join(ROOT, "deployment.json"), encoding="utf-8"))
keep = {k: {"address": dep[k]["address"]} for k in ("escalate", "court_escalation_manager", "optimistic_oracle_v3", "store", "testusd")}
script = script.replace("__DEP__", json.dumps(keep))

head = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Escalate: Internet Court for UMA's Optimistic Oracle</title>
<meta name="description" content="An open source GenLayer testnet demo: a disputed assertion on UMA's Optimistic Oracle V3, ruled by Internet Court from its cited sources and settled on chain." />
<link rel="icon" href="docs/logo.svg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&family=Newsreader:ital,opsz,wght@0,6..72,500;1,6..72,500&display=swap" rel="stylesheet" />
<style>
""" + src + """
</style>
</head>
"""
open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8", newline="\n").write(head + body + script)
print("index.html written")
