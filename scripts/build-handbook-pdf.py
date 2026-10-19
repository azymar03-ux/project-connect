"""Build ProjectConnect_Handbook PDF from the docs/ markdown + flowchart HTML."""
import re, sys, markdown

DOCS = "docs/"
OUT = DOCS + "ProjectConnect_Handbook_2026-10-12.pdf"

def md2html(path):
    return markdown.markdown(open(path).read(),
        extensions=["tables", "fenced_code", "sane_lists"])

master = md2html(DOCS + "MASTER_PROMPT.md")
tech = md2html(DOCS + "TECH_STACK.md")
user = md2html(DOCS + "USER_GUIDE.md")
owner = md2html(DOCS + "OWNER_GUIDE.md")
rev = md2html(DOCS + "REVENUE_STREAMS.md")
launch = md2html(DOCS + "LAUNCH_PLAYBOOK.md")
sales = md2html(DOCS + "SALES_MARKETING.md")

fc = open(DOCS + "BEGINNER_FLOWCHART.html").read()
style = re.search(r"<style>(.*?)</style>", fc, re.S).group(1)

def scope(style):
    out = []
    for m in re.findall(r"([^{}]+)\{([^{}]*)\}", style):
        sels = [s.strip() for s in m[0].strip().split(",")]
        news = []
        for s in sels:
            if s == ":root":
                news.append("section.fcsec")
            elif s == "*":
                news.append("section.fcsec *")
            elif s == "body":
                news.append("section.fcsec")
            else:
                news.append("section.fcsec " + s)
        out.append(", ".join(news) + "{" + m[1] + "}")
    return "\n".join(out)

body = re.search(r'(<div class="wrap">.*</div>)\s*</body>', fc, re.S).group(1)
body = body.replace("<h1>ProjectConnect — the whole journey, start to finish</h1>",
    '<p class="sub" style="margin-top:0">The same flowchart from today, embedded for reference.</p>', 1)
fc_body = f'<section class="fcsec" style="break-before:auto">{body}</section>'

css = """
@page{size:A4;margin:16mm 13mm 17mm 13mm;
 @bottom-center{content:"ProjectConnect Handbook · 12 Oct 2026 · page " counter(page) " / " counter(pages);font-size:8pt;color:#5b7186;font-family:"DejaVu Sans";}}
html{font:9.8pt/1.5 "DejaVu Sans",sans-serif;color:#122a3a}
body{margin:0}
.cover{text-align:center;padding-top:96px}
.cover h1{font-size:27pt;margin:0 0 8px;color:#0f2e4d}
.cover p.sub{font-size:12pt;color:#41627a;margin:4px 0}
.cover .parts{margin-top:28px;font-size:10.4pt;color:#28425a;text-align:left;display:inline-block}
.cover .parts div{margin:5px 0}
h1.part{font-size:16pt;color:#0f2e4d;border-bottom:2.4px solid #1d5fd8;padding-bottom:5px;margin:0 0 10px;break-before:page}
.partsub{color:#41627a;margin:-4px 0 12px;font-size:9.2pt}
h2{font-size:11.8pt;color:#123c66;margin:13px 0 5px;break-after:avoid}
h3{font-size:10.5pt;color:#1d5fd8;margin:9px 0 3px;break-after:avoid}
p,li{margin:3px 0}
code{font-family:"DejaVu Sans Mono";font-size:8.4pt;background:#eef4f9;border-radius:4px;padding:0 3px}
pre{font-family:"DejaVu Sans Mono";font-size:7.3pt;line-height:1.34;background:#f2f6fa;border:1px solid #c8d8e4;border-radius:8px;padding:8px 10px;white-space:pre-wrap;break-inside:avoid}
table{border-collapse:collapse;width:100%;font-size:8.6pt;margin:6px 0}
th,td{border:1px solid #c8d8e4;padding:4px 7px;text-align:left;vertical-align:top}
th{background:#eaf1f7}
blockquote{margin:6px 0;padding:6px 12px;border-left:4px solid #1d5fd8;background:#f2f6fa;color:#28425a}
hr{border:none;border-top:1px solid #c8d8e4;margin:12px 0}
section.fcsec{break-before:page;padding:10px 12px}
section.fcsec h2,section.fcsec h3{margin-top:0}
"""

def part(title, sub, b):
    b = re.sub(r"^\s*<h1>.*?</h1>\s*", "", b, count=1, flags=re.S)  # part heading already names it
    return f'<h1 class="part">{title}</h1><p class="partsub">{sub}</p>{b}'

cover = """<div class="cover"><h1>ProjectConnect</h1>
<p class="sub"><b>The Complete Handbook</b> — all content requested on 12 October 2026</p>
<div class="parts">
<div><b>Part I</b> &nbsp;&nbsp;·&nbsp; End-to-End Master Prompt — the full build contract</div>
<div><b>Part II</b> ·&nbsp; Tech Stack — every technology, its version, and its use</div>
<div><b>Part III</b> · End-to-End Flow — the beginner-developer flowchart</div>
<div><b>Part IV</b> · Full Website Use — for a USER, screen by screen</div>
<div><b>Part V</b> &nbsp;&nbsp;· Full Website Use — for the OWNER / COMPANY</div>
<div><b>Part VI</b> · Revenue Streams — pricing mapped to enforcement that exists</div>
<div><b>Part VII</b> · Launch, Deploy &amp; Hosting Playbook — the recommended method</div>
<div><b>Part VIII</b> · Sales &amp; Marketing — 90-day plan, channels, buyers, budget</div>
</div>
<p class="sub" style="margin-top:24px">Source of truth: <code>/home/user/projectconnect</code> · 118/118 automated tests passing<br>Status: NOT READY FOR PRODUCTION LAUNCH — remaining gates in docs/LAUNCH_STATUS.md</p></div>"""

html = (f'<!doctype html><html><head><meta charset="utf-8"><style>{css}\n{scope(style)}</style></head><body>{cover}'
    + part("Part I — Master Prompt", "The entire project contract: mission, scope, stack, data invariants, flows, validation gates, runbook, deliverables.", master)
    + part("Part II — Tech Stack", "Audited versions from package.json, Dockerfile, deploy/ and source — with what each is used for.", tech)
    + part("Part III — End-to-End Flow", "Beginner flowchart: arrival → registration → login/session → core loop → uploads → security gauntlet → ship.", fc_body)
    + part("Part IV — For Users", "What the website does for a member, screen by screen.", user)
    + part("Part V — For the Owner", "Setup, admin, operations, money, and the honest launch state.", owner)
    + part("Part VI — Revenue Streams", "How this platform monetises, mapped to the enforcement points already in the code.", rev)
    + part("Part VII — Launch, Deploy & Hosting", "Six launch phases, the recommended deployment method, step-by-step runbook, scaling ladder, go/no-go gate.", launch)
    + part("Part VIII — Sales & Marketing", "Positioning, buyers, 90-day launch motion, channels, sales plays, metrics, budget.", sales)
    + "</body></html>")

open("/tmp/handbook.html", "w").write(html)
from weasyprint import HTML
HTML(string=html, base_url=".").write_pdf(OUT)
print("wrote", OUT)
