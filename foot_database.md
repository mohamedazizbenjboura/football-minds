I created the database specification as a **professional source-of-truth `.md` document** designed specifically for **Football Minds**.

This is not a normal football database. It is a **Football Knowledge Engine** designed to power:

* Guess The Player
* Who Am I?
* Career Maze
* Football Pyramid
* Last Man Standing
* The Chain
* Shirt Number Madness
* Party Mode
* Future AI football modes

It includes:

* every player worldwide (active + retired)
* every club worldwide
* every league worldwide
* player photos
* club logos
* career history
* transfers
* teammates graph
* shirt numbers
* trophies
* national teams
* managers
* stadiums
* aliases
* search optimization
* caching strategy
* image system
* PostgreSQL schema
* Prisma structure
* import pipeline
* API architecture

You can save this as:

`FOOTBALL_MINDS_DATABASE_MASTER_SPEC.md`

```md
# ⚽ Football Minds — Global Football Knowledge Database Master Specification

Version: 1.0  
Project: Football Minds  
Purpose: Ultimate Football Party Game Engine

---

# 1. Vision

Football Minds does not use a simple football player list.

It requires a complete football knowledge graph capable of understanding:

- Every professional football player in the world
- Active players
- Retired legends
- Historical players
- Every professional club
- Every league and competition
- Career timelines
- Transfers
- Teammates
- Shirt numbers
- Positions
- National teams
- Trophies
- Achievements

The database must power every game mode:

- Guess The Player
- Who Am I?
- Career Maze
- Football Pyramid
- Last Man Standing
- The Chain
- Shirt Number Madness
- Party Mode

---

# 2. Database Philosophy

Rule:

> If information describes a football entity forever, it belongs in the Football Knowledge Database.

Examples:

YES:
- Messi played for Barcelona
- Ronaldo wore number 7
- Neymar was teammate of Suarez
- Eto'o won Champions League

NO:
- Player currently typing an answer
- Room timer
- Current match state

Live game data belongs to Socket.io.

Permanent football knowledge belongs here.

---

# 3. Main Architecture


```

```
             Football Minds

                   |
                   |

      Football Knowledge API

                   |

          PostgreSQL Database

                   |
```

---

Players
Clubs
Leagues
Careers
Transfers
Relations
Statistics
Achievements
Images
Search Engine

---

```
                   |

          Game Engines
```

Guess The Player
Who Am I?
Career Maze
The Chain
etc.

```

---

# 4. Database Technology


## Primary Database

PostgreSQL


## ORM

Prisma


## Search

PostgreSQL Full Text Search

+

Optional:

Meilisearch / Elasticsearch


## Image Storage

Images are NOT stored directly.

Store:

- provider ID
- image URL
- cache status


Sources:

- TheSportsDB
- Football APIs
- CDN cache


---

# 5. Core Entities


# PLAYERS


Table:

players


Purpose:

The complete football player universe.


Fields:


```

id
external_ids

first_name
last_name
full_name

display_name

date_of_birth

nationality_id

secondary_nationalities

birth_place

height_cm

weight_kg

preferred_foot

position

secondary_positions

career_status

active
retired
unknown

retirement_date

current_club_id

photo_url

photo_provider

created_at
updated_at

```


Example:


```

Lionel Messi

Nationality:
Argentina

Position:
RW

Foot:
Left

Status:
Active

```

---

# 6. Player Aliases


Purpose:

Improve search.


Table:

player_aliases


Fields:

```

id

player_id

alias

language

type

```


Examples:

```

Cristiano Ronaldo
CR7

Ronaldo Nazario
R9

```

---

# 7. Clubs


Table:

clubs


Fields:


```

id

name

short_name

country_id

city

stadium_id

founded_year

league_id

logo_url

logo_provider

historical_names

created_at
updated_at

```


Examples:


```

Esperance Sportive de Tunis

Real Madrid

Al Ahly

Santos

Kawasaki Frontale

```

---

# 8. Club Logos


Table:

club_images


```

id

club_id

image_url

provider

resolution

cached

created_at

```


Priority:

1.
TheSportsDB

2.
Official club source

3.
Generated fallback crest


---

# 9. Player Images


Table:

player_images


```

id

player_id

image_url

provider

quality

cached

```


System:


```

PlayerAvatar Component

```
    |
```

API Route

```
    |
```

Image Cache

```
    |
```

Real Photo

```
    |
```

Fallback Avatar

```

---

# 10. Countries


Table:

countries


```

id

name

code

continent

```


Examples:

Tunisia

Morocco

Brazil

Japan

England


---

# 11. Leagues


Table:

leagues


Every league worldwide.


Fields:


```

id

name

country_id

level

tier

continent

logo_url

active

founded_year

```


Examples:


```

Premier League

La Liga

Serie A

Bundesliga

Ligue 1

Tunisian Ligue 1

Botola Pro

Saudi Pro League

J-League

MLS

```

---

# 12. Competitions


Table:

competitions


```

id

name

type

country

continent

```


Examples:


```

Champions League

World Cup

AFCON

Asian Cup

```

---

# 13. Player Career History


IMPORTANT FOR:

Career Maze


Table:

player_careers


```

id

player_id

club_id

joined_date

left_date

season_start

season_end

appearances

goals

assists

loan

competition_level

```


Example:


```

Hakim Ziyech

Heerenveen
2012-2014

Ajax
2016-2020

Chelsea
2020-2024

Galatasaray
2024-

```

---

# 14. Transfers


Table:

transfers


```

id

player_id

from_club_id

to_club_id

transfer_date

fee

loan

free_transfer

```


Used for:

Transfer Wizard achievements.

---

# 15. Player Relationship Graph


CRITICAL FOR:

THE CHAIN


Table:

player_relationships


```

id

player_a_id

player_b_id

relationship_type

club_id

start_date

end_date

```


Relationship types:


```

teammate

national_team_teammate

coach_player

rival

```


Example:


```

Messi

|

teammate

|

Neymar

```


Generated automatically:

If two players were in the same squad:

Create relationship.

---

# 16. Shirt Numbers


For:

Shirt Number Madness


Table:


player_numbers


```

id

player_id

club_id

number

season

competition

```


Example:


```

Cristiano Ronaldo

Manchester United

7

2021

```

---

# 17. Positions


Table:


positions


```

id

name

category

```


Examples:


```

Goalkeeper

Defender

Midfielder

Forward

Left Wing
Right Wing

```

---

# 18. Player Statistics


Table:


player_statistics


```

id

player_id

season

club_id

matches

goals

assists

clean_sheets

yellow_cards

red_cards

```


---

# 19. Trophies


Table:


trophies


```

id

name

competition_id

year

```


---

# 20. Player Achievements


Table:


player_trophies


```

id

player_id

trophy_id

year

club_id

```


Examples:


```

Messi

Champions League

2015

```

---

# 21. National Teams


Table:


national_teams


```

id

country_id

name

```


---

# 22. National Team Career


Table:


player_national_team


```

player_id

national_team_id

debut_date

caps

goals

```


---

# 23. Managers


Table:


managers


```

id

name

nationality

birth_date

photo_url

```


---

# 24. Stadiums


Table:


stadiums


```

id

name

capacity

city

country

```


---

# 25. Game Support Indexes


Required indexes:


```

players.name

players.nationality

players.position

clubs.name

player_careers.player_id

player_relationships.player_a_id

player_relationships.player_b_id

```


---

# 26. Game Queries


## Guess The Player


Example:


Find:

```

Tunisian
Left winger
Played France

```

Query:

```

players
+
nationality
+
careers

```


---

## Career Maze


Uses:


```

player_careers

clubs

club_images

```


---

## The Chain


Uses:


```

player_relationships

```


---

## Shirt Number Madness


Uses:


```

player_numbers

```


---

# 27. Data Import Pipeline


Sources:


## Active football


Football API provider


Provides:

- players
- teams
- leagues
- statistics


---


## Historical football


Wikidata


Provides:

- retired legends
- historical clubs
- achievements


---


## Career data


Transfer database provider


Provides:

- transfers
- career timeline


---


## Images


TheSportsDB


Provides:

- player photos
- club logos


---

# 28. Expected Database Size


Launch:


```

Players:
100,000+

Clubs:
20,000+

Leagues:
2,000+

Countries:
200+

Career Records:
1,000,000+

Relations:
5,000,000+

```


Full version:


```

Players:
500,000+

Career records:
10M+

Relations:
50M+

```


---

# 29. Football Minds Final Rule


The database must allow this:


"Give me a random retired Brazilian striker who played in Italy, won Champions League, wore number 9, and had a teammate connection with Ronaldo."


If the database can answer this instantly:

Football Minds is ready.

---

END OF SPECIFICATION
```

This database design matches your vision much better than a normal player API. It turns Football Minds into a **football knowledge graph**, which is what you need for the games to feel intelligent and endless.
