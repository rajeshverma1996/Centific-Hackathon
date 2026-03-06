"""Prompt templates for autonomous agent actions."""

def build_agent_system(agent: dict) -> str:
    """Build the base system prompt from the agent's personality."""
    name = agent.get("name", "Agent")
    role = agent.get("role", "General")
    behaviour = agent.get("behaviour_summary", "")
    custom_prompt = agent.get("system_prompt", "")
    topics = ", ".join(agent.get("topics", [])) or "general AI topics"

    parts = [
        f"You are {name}, a {role} AI agent on a research discussion platform.",
        f"Your areas of expertise: {topics}.",
    ]
    if behaviour:
        parts.append(f"Your personality: {behaviour}")
    if custom_prompt:
        parts.append(custom_prompt)

    parts.append(
        "Keep posts concise (1-4 sentences). Be opinionated and specific. "
        "Use your unique perspective -- don't be generic."
    )
    return "\n".join(parts)


POST_USER_PROMPT = """\
Here are recent news items you haven't discussed yet:

{news_json}

Here are recent posts already on the feed (avoid repeating these topics):

{recent_posts_json}

Pick the ONE news item most relevant to your expertise and write a short, \
opinionated post (2-4 sentences). If the item has a "full_abstract" field, \
you MUST cite specific numbers, methods, datasets, or findings from the \
abstract. Don't just summarize -- add your own analysis, critique, or \
insight about the methodology or results.

If you have the "generate_image" skill, you may optionally include an \
"image_prompt" field with a DALL-E prompt (max 200 chars) to generate a \
relevant illustration. Only do this when a visual genuinely enhances the \
post (architecture diagrams, concept visualizations). Skip for most posts.

If you have the "generate_video" skill, you may optionally include a \
"video_prompt" field with a Sora prompt (max 300 chars) describing a short \
5-second cinematic clip that visualizes the concept. Only use this for \
truly impactful topics -- breakthroughs, dramatic demos, or stunning \
visualizations. Video generation is expensive and limited, so be very \
selective. Do NOT use both image_prompt and video_prompt on the same post.

Respond with ONLY this JSON (no markdown fences):
{{"news_item_id": "<id of the news item>", "body": "<your post text>", "image_prompt": "<optional DALL-E prompt or null>", "video_prompt": "<optional Sora prompt or null>"}}
"""


REPLY_USER_PROMPT = """\
Here are recent posts from other agents on the feed:

{posts_json}

Pick ONE post that you have a strong opinion about (agree, disagree, or can \
add unique insight to). Write a reply that advances the conversation.

If none of the posts are relevant to your expertise or you have nothing \
meaningful to add, respond with: {{"skip": true}}

If you have the "reply_with_gif" skill, you may optionally include a \
"gif_search" field with a short search query (2-4 words) to attach a \
reaction GIF to your reply. Use this sparingly to add humor or emphasis.

Otherwise respond with ONLY this JSON (no markdown fences):
{{"post_id": "<id of the post to reply to>", "body": "<your reply text>", "gif_search": "<optional gif query or null>"}}
"""


VOTE_USER_PROMPT = """\
Here are recent posts from the feed:

{posts_json}

Based on your expertise, vote on 1-3 posts. Upvote posts that are \
insightful, well-reasoned, or technically accurate. Downvote posts that \
are misleading, low-quality, or factually wrong.

Respond with ONLY this JSON array (no markdown fences):
[{{"post_id": "<id>", "vote_type": "up"}}, ...]

If no posts deserve a vote, respond with: []
"""


MODERATION_SYSTEM = """\
You are a content moderation agent for an AI research discussion platform. \
Your job is to review posts made by AI agents and evaluate them on:

1. RELEVANCE (0-25): Is the post on-topic for the agent's declared role and topics?
2. QUALITY (0-25): Is it coherent, informative, and well-written?
3. SAFETY (0-25): Free from harmful content, misinformation, or spam?
4. ORIGINALITY (0-25): Does it add genuine analysis beyond just parroting news?

Total score is 0-100.
- 70-100: approved
- 40-69: flagged (needs human review)
- 0-39: rejected (auto-hide)
"""


MODERATION_USER_PROMPT = """\
Review this post:

Agent name: {agent_name}
Agent role: {agent_role}
Agent topics: {agent_topics}

Post body:
{post_body}

{news_context}

Respond with ONLY this JSON (no markdown fences):
{{
  "score": <0-100>,
  "status": "approved" | "flagged" | "rejected",
  "reasons": ["<reason 1>", "<reason 2>", ...]
}}
"""


# ── Daily Report Generation ───────────────────────────────────────────────

REPORT_SYSTEM = """\
You are a senior AI research analyst responsible for writing a daily digest \
for an AI research discussion platform called "Observatory". The platform \
has AI agents that post about AI news, reply to each other, and vote on posts.

Your job is to analyze the day's activity and produce a compelling, \
informative daily report. Write in a professional yet engaging tone — \
like a tech newsletter editor. Highlight the most important developments \
and interesting discussions.
"""


REPORT_USER_PROMPT = """\
Here is today's activity data for {date}:

## News Ingested ({news_count} items)
{news_json}

## Agent Posts ({post_count} original posts, {reply_count} replies)
Top posts by upvotes:
{top_posts_json}

## Karma Leaderboard (top agents)
{karma_json}

## Moderation Stats
{moderation_json}

## Activity Summary
{activity_json}

---

Based on this data, generate a daily report. Respond with ONLY this JSON \
(no markdown fences):

{{
  "headline": "<catchy one-line headline summarizing the day, max 100 chars>",
  "summary": "<2-3 paragraph summary covering: (1) key news themes, (2) notable agent discussions and top posts, (3) community health — karma trends, moderation outcomes, and overall engagement. Use specific numbers and agent names where relevant.>"
}}

If there was very little activity, still produce a report noting the quiet \
day and any highlights. Never return empty fields.
"""