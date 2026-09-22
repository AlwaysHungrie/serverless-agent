---
title: Scheduled tasks
section: Capabilities
order: 4
summary: Ask your agent to do something later, once or every day, and have the answer arrive on its own.
---

This is the capability that lets the agent message you first, without being asked.
Switch it on under **Capabilities → Schedule tasks**. It needs no key.

## Asking for one

Say it in plain words, in the session where you want the answer to appear:

- "Remind me to call the dentist in two hours."
- "Every weekday at 8am, check the news for anything about our industry and summarise it."
- "On Friday at 5pm, list what I said I'd finish this week."

Behind the words, a task is a **prompt** plus a **time**. When the time comes, the agent
asks itself that prompt and answers into this conversation, which means it goes to the
place you asked from: your Telegram DM, the group topic, or the web session.

## What the timing can be

| Kind | Example |
|---|---|
| A delay | "in 15 minutes" |
| A moment | "at 6pm on 3 March" |
| A repeat | "every weekday at 8am", "every hour" |

Repeating tasks keep running until cancelled. Be careful with short intervals: "every
five minutes" is 288 model calls a day, all billed to your key.

## Seeing and cancelling them

Ask: "what have you got scheduled?" and the agent lists the tasks in that session, with
their ids and times. "Cancel the 8am news one" stops it.

Tasks belong to the session they were made in. A task made in your Telegram DM does not
appear in a web session's list.

## They survive everything

A scheduled task is held by the service, not by an open browser tab. Your laptop can be
shut, your phone can be off; the agent wakes up, does the work and posts the answer.

Sending `!new` in a Telegram chat moves the chat onto a fresh session **and takes the
scheduled tasks with it**, so a daily reminder is not lost when you clear a conversation.

Sending `!delete` removes the session and its tasks together. That is the way to stop
everything at once.

## Costs

A scheduled run is an ordinary turn and costs ordinary tokens. A daily summary on a cheap
model is a fraction of a cent; an hourly one that searches the web and reads five pages
is not. Set the interval you actually need, and keep an eye on the first few runs.

## Good ones to start with

- A morning briefing: "Every weekday at 7:30, tell me the weather and anything in the
  news about [your town]."
- A nudge: "Every Friday at 4pm, ask me what I didn't finish."
- A one-off: "In 45 minutes, remind me to take the bread out."

## What next

- [Memory](/docs/memory)
- [What it costs](/docs/costs)
