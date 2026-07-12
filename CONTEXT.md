# Ed Discussion Access

This context describes the Ed Discussion data that agents and people inspect or update through the local CLI and MCP adapters.

## Language

**Ed Identity**:
The authenticated Ed user and their enrolled Courses, verified by the token owner endpoint.
_Avoid_: Account, profile

**Ed Token**:
A bearer credential issued by Ed that grants access as one Ed Identity.
_Avoid_: API key, password

**Course**:
An Ed teaching space in which Lessons, Threads, and Activity belong.
_Avoid_: Class, subject

**Lesson Module**:
A named grouping of Lessons within a Course.
_Avoid_: Section, folder

**Lesson**:
A structured learning item made of Slides and optionally Quiz Questions.
_Avoid_: Tutorial, page

**Slide**:
One ordered part of a Lesson whose progress can be viewed or completed.
_Avoid_: Step, screen

**Quiz Question**:
An assessable prompt on a Slide with saved Responses.
_Avoid_: Exercise, item

**Thread**:
A numbered Course discussion containing an initial post, Answers, and Comments.
_Avoid_: Post, topic

**Activity**:
A recent event relevant to an Ed Identity, optionally scoped to a Course.
_Avoid_: Notification, feed item

**Lesson Progress**:
The Ed Identity's viewed or completed state for a Lesson and its Slides.
_Avoid_: Read receipt, completion record
