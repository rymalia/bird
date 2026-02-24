# Thread Tweet Examples

**SEE SUPPORT REQUIREMENTS BELOW**

**NOTE:** this list uses `--json-full` instead of `--all --json` because I am not familiar with the actual usage

## Example Cases

### Example 1a: Classic Thread, Just Author

* tweet url: https://x.com/mhdfaran/status/2025949510678233209
* bird thread: `bird thread 2025949510678233209 --json-full`
* id of conversation root : `2025949510678233209`
* id of another author tweet in conversation: `2025949534921367553`
* id of final author tweet in conversation: `2025949570703011889`

### Example 1b: Classic Thread, Just Author

* tweet url: https://x.com/Mylovanov/status/2026045774593761492
* bird thread: `bird thread 2026045774593761492 --json-full`
* id of conversation root : `2026045774593761492`
* id of another author tweet in conversation: `2026045786241581210`
* id of final author tweet in conversation: `2026045793501675725`

### Example 2: Very Long Classic Thread, Just Author
*16 author tweets in the conversation*

* tweet url: https://x.com/hlntnr/status/2016204340029948284
* bird thread: `bird thread 2016204340029948284 --json-full`
* id of conversation root: `2016204340029948284`
* id of another author tweet in conversation: `2016204360611434782`
* id of final author tweet in conversation: `2016204370547802221`


### Example 3: Author Replies to Thread Responses
*Author responding to other's responses, not to their own tweets*

* tweet url: https://x.com/alexhillman/status/2026128374179987514
* bird thread: `bird thread 2026128374179987514 --json-full`
* id of conversation root: `2026128374179987514`
* id of an author tweet in thread in response to other: `2026123438901846046`
  * not included in --json-full 🤨 
* id of an author tweet in thread in response to other: `2026131825492402224`
  *  included in --json-full 🤷️
* id of an author tweet in thread in response to other: `2026130969636266174`
  * not included in --json-full 🤨 


### Example 4: Note Tweet Thread
*conversation root is `note_tweet`*

* tweet url: https://x.com/milan_milanovic/status/2025835518207127968
* bird thread: `bird thread 2025835518207127968 --json-full`
* id of conversation root: `2025835518207127968`
* id of another author tweet in conversation: `2025852255610564814`
* id of final author tweet in conversation: `2025869144059494797`

```json
  "note_tweet": {
	"is_expandable": true,
	"note_tweet_results": {
	  "result": {
		"entity_set": {
		  "hashtags": [],
		  "symbols": [],
		  "urls": [],
		  "user_mentions": []
		},
		"id": "Tm90ZVR3ZWV0OjIwMjU4MzU1MTc2NzQ1MDgyODg=",
		"text": "𝗚𝗶𝘁 𝗪𝗼𝗿𝗸𝘁𝗿𝗲𝗲: 𝗧𝗵𝗲 𝗙𝗲𝗮𝘁𝘂𝗿𝗲 𝗬𝗼𝘂'𝘃𝗲 𝗛𝗮𝗱 𝗦𝗶𝗻𝗰𝗲 𝟮𝟬𝟭𝟱 𝗕𝘂𝘁 𝗡𝗲𝘃𝗲𝗿 𝗨𝘀𝗲𝗱\n\nYou're mid-feature, deep in a branch. A critical... "
	  }
	}
  },
```

## Summary & Priorities

### Use Case Requirements for Thread Expansion

* Example 1 - Classic Thread: **MANDATORY, MUST SUPPORT**
* Example 2 - Very Long Thread: **MANDATORY, MUST SUPPORT**
* Example 3 - Author Replies to Thread Responses: Support not required - nice if we can get it.
* Example 4 - Note Tweet Thread: **MANDATORY, MUST SUPPORT**


