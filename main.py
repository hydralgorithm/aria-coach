"""Aria - CLI voice chatbot (Groq Llama + Groq Whisper + local Kokoro TTS).

Usage:
    python main.py            # voice conversation loop
    python main.py --text     # keyboard-only (no mic needed)
"""

from __future__ import annotations

import argparse
import sys
import time

import brain
import tts
from audio import record_until_silence

BANNER = """
  ============================================
     ARIA  -  your voice interview coach (v0)
  ============================================
   speak freely  |  Ctrl+C to quit
   commands: /reset (new session)  /quit
  ============================================
"""


def voice_turn() -> None:
    wav = record_until_silence()
    if not wav:
        return
    try:
        started = time.time()
        user_text = brain.transcribe(wav)
        print(f"  [stt] {time.time() - started:.1f}s")
    except Exception as exc:
        print(f"  [stt] failed: {exc}")
        return
    if not user_text:
        return
    print(f"  you  > {user_text}")
    respond(user_text)


def text_turn() -> None:
    try:
        user_text = input("  you  > ").strip()
    except EOFError:
        print()
        return
    if user_text:
        respond(user_text)


def respond(user_text: str) -> None:
    try:
        started = time.time()
        reply = brain.chat(user_text)
        print(f"  aria > {reply}   ({time.time() - started:.1f}s)")
        tts.speak(reply)
    except Exception as exc:
        print(f"  [brain] failed: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Aria voice chatbot")
    parser.add_argument("--text", action="store_true", help="keyboard only")
    args = parser.parse_args()

    print(BANNER)
    tts.speak("Hey! I'm Aria. Ready to practice talking with me?")

    while True:
        try:
            if args.text:
                text_turn()
            else:
                voice_turn()
        except KeyboardInterrupt:
            print("\n  (Ctrl+C again or /quit to exit)")
            try:
                if input("  really quit? [y/N] > ").strip().lower() == "y":
                    break
            except EOFError:
                break


if __name__ == "__main__":
    main()
