#!/usr/bin/env python3
"""Refresh GitHub stats in data/works.json without touching hand-written copy.

Usage:  python3 scripts/refresh_works.py [--token GITHUB_TOKEN]

- Updates stars / language / pushed date / url / description for every
  featured and archive entry.
- Appends any new non-fork repo to `archive` with tags ["untagged"],
  unless it is listed in `skipRepos`.
"""
import argparse
import datetime as dt
import json
import os
import urllib.request
from pathlib import Path

USER = "XmYx"
WORKS = Path(__file__).resolve().parent.parent / "data" / "works.json"


def fetch_repos(token=None):
    repos, page = [], 1
    while True:
        req = urllib.request.Request(
            f"https://api.github.com/users/{USER}/repos?per_page=100&page={page}",
            headers={"Accept": "application/vnd.github+json", "User-Agent": "magix-refresh"},
        )
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(req, timeout=30) as res:
            batch = json.load(res)
        if not batch:
            return repos
        repos += batch
        page += 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--token", default=os.environ.get("GITHUB_TOKEN"))
    args = ap.parse_args()

    works = json.loads(WORKS.read_text(encoding="utf-8"))
    by_name = {r["name"]: r for r in fetch_repos(args.token) if not r["fork"]}

    known = set(works.get("skipRepos", []))
    for entry in works["featured"] + works["archive"]:
        known.add(entry["repo"])
        r = by_name.get(entry["repo"])
        if not r:
            print(f"! {entry['repo']} not found on GitHub (renamed or private?)")
            continue
        entry.update(
            stars=r["stargazers_count"],
            language=r["language"],
            pushed=r["pushed_at"][:10],
            url=r["html_url"],
            description=r["description"],
        )

    for name, r in sorted(by_name.items()):
        if name in known:
            continue
        print(f"+ new repo: {name}")
        works["archive"].append({
            "repo": name, "tags": ["untagged"],
            "stars": r["stargazers_count"], "language": r["language"],
            "pushed": r["pushed_at"][:10], "url": r["html_url"], "description": r["description"],
        })

    works["archive"].sort(key=lambda e: e.get("pushed", ""), reverse=True)
    works["generated"] = dt.date.today().isoformat()
    WORKS.write_text(json.dumps(works, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"updated {WORKS}")


if __name__ == "__main__":
    main()
