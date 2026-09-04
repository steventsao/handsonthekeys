# WebMCP Challenge judges and judging criteria

Last verified: September 3, 2026.

This is a working reference for the team, based on the [WebMCP Challenge
page](https://webmcp.devpost.com/#judges) and [official
rules](https://webmcp.devpost.com/rules#7-judges-criteria). If this document and
Devpost ever disagree, Devpost is the source of truth.

## Publicly listed judges

| Judge          | Published role                                        |
| -------------- | ----------------------------------------------------- |
| Andrew Galloni | VP Research & Innovation, Cloudflare                  |
| Alex Nahas     | Creator of MCP-B                                      |
| Ilya Grigorik  | Distinguished Engineer, Shopify                       |
| Jude Gao       | Member of Technical Staff, Vercel · Next.js Core Team |
| Justin Rushing | Browser Platform Lead, OpenAI                         |
| Sarah Drasner  | Distinguished Engineer, Chrome, Google                |
| Sean Roberts   | VP of Applied AI, Netlify                             |

The rules define the judging body more broadly than this public list. The
Sponsor selects the panel; judges may be Sponsor employees or third parties,
listed or unlisted, and the panel may change before or during judging. The
Sponsor and Administrator may use expert panels, peer review, automated
AI-driven analysis, or a combination of those methods, across one or more
rounds.

## Evaluation process

### Stage 1: baseline viability (pass/fail)

A submission must reasonably fit the challenge theme and reasonably use the
required APIs or SDKs. A project that does not clear this gate is not scored in
Stage 2.

For this project, the submission should make the WebMCP implementation and the
human-agent collaboration central and easy to verify—not an incidental feature
or a claim that exists only in the description.

### Stage 2: equally weighted criteria

All four criteria carry equal weight.

| Criterion                 | What the official criterion asks                                                                                                           | What we should make obvious                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **WebMCP Leverage**       | Is WebMCP used thoroughly and skillfully, with genuine effort and a working, non-trivial implementation?                                   | Show the exposed tools working end to end, explain why structured tool use improves the experience, and make the implementation inspectable. |
| **Execution**             | Is this a runnable, coherent, complete product experience rather than only a technical proof of concept?                                   | Keep the live flow reliable and polished, with understandable states, recovery paths, and a clear user journey.                              |
| **Potential Impact**      | Does the project make a credible and specific case that it solves a real problem for a real audience, and does the demo support that case? | Name the audience and problem precisely, then demonstrate the concrete improvement instead of relying on broad claims.                       |
| **Creativity & Ambition** | Is the concept creative and novel, and does it differ from existing ideas?                                                                 | Lead with what people and agents can now do together that was previously difficult or impossible.                                            |

## Tie-breaking order

Although the four Stage 2 criteria are equally weighted, ties are resolved in
the order above:

1. WebMCP Leverage
2. Execution
3. Potential Impact
4. Creativity & Ambition

If submissions remain tied after all four comparisons, the judging panel votes
on the tied submissions.

## What judges may review

Judges may test the live project, but the rules do not require them to do so.
They may judge from the submitted description, images, and demo video alone.
That makes the submission materials part of the product evaluation:

- Keep the live URL available, free to test, and accessible in ChatGPT's in-app
  browser or Chrome with WebMCP enabled through the end of judging.
- Make the required public YouTube demo self-contained and shorter than three
  minutes; judges do not have to watch beyond the three-minute mark.
- Ensure the description and demo independently establish the audience,
  problem, WebMCP implementation, human-agent workflow, and working result.
- Put any required login credentials and testing instructions in the private
  submission field.

## Schedule

- Judging: September 4, 2026 at 10:00 a.m. PT through September 21, 2026 at
  5:00 p.m. PT
- Winners announced: on or around September 23, 2026 at 2:00 p.m. PT

## Sources

- [WebMCP Challenge overview: judges and criteria](https://webmcp.devpost.com/#judges)
- [Official Rules §7: Judges & Criteria](https://webmcp.devpost.com/rules#7-judges-criteria)
- [Official Rules §1: Dates and Timing](https://webmcp.devpost.com/rules#1-dates-and-timing)
- [Official Rules §4: How to Enter and submission requirements](https://webmcp.devpost.com/rules#4-how-to-enter)
