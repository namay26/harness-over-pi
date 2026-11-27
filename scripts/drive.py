"""Types one request into the CLI, accepts every default, and quits when the run ends.

Usage: python3 -I scripts/drive.py <project> "<request>"   (extra prompts are never sent a blank line)
"""
import os, subprocess, sys

project, request = sys.argv[1], sys.argv[2]
cli = subprocess.Popen(["npm", "start", "--silent", "--", project], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT)
buffer, sent = "", False
while True:
    chunk = os.read(cli.stdout.fileno(), 4096).decode(errors="replace")
    if not chunk:
        break
    sys.stdout.write(chunk)
    sys.stdout.flush()
    buffer += chunk
    if buffer.endswith("] > "):  # a question or the approval: accept the default
        reply = ""
    elif buffer.endswith("\n> "):
        reply, sent = ("/exit" if sent else request), True
    else:
        continue
    sys.stdout.write(f"{reply}\n")
    cli.stdin.write(f"{reply}\n".encode())
    cli.stdin.flush()
    buffer = ""
sys.exit(cli.wait())
