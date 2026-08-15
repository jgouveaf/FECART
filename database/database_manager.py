from __future__ import annotations

import sqlite3
import threading
import unicodedata
from pathlib import Path
from typing import List, Optional, Sequence

from datetime import datetime

from core.models import EventRecord, FaceEmbeddingRecord, PersonRecord, SystemEvent, TrackedTarget


class DuplicatePersonError(ValueError):
    """Nome normalizado ja pertence a um cadastro persistente."""


def normalize_person_name(name: str) -> tuple[str, str]:
    """Retorna nome de exibicao e chave estavel, insensivel a caixa/acentos."""
    display = " ".join(name.strip().split())
    ascii_key = unicodedata.normalize("NFKD", display).encode("ascii", "ignore").decode("ascii")
    return display, ascii_key.casefold()


class DatabaseManager:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        self._init_schema()

    def _init_schema(self) -> None:
        with self.lock:
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    name TEXT,
                    track_id INTEGER,
                    confidence REAL,
                    event TEXT NOT NULL,
                    state TEXT NOT NULL
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS people (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    photo_path TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            columns = {
                str(row[1])
                for row in self.connection.execute("PRAGMA table_info(people)").fetchall()
            }
            if "name_key" not in columns:
                self.connection.execute("ALTER TABLE people ADD COLUMN name_key TEXT")
            for person_id, existing_name in self.connection.execute(
                "SELECT id, name FROM people WHERE name_key IS NULL OR name_key = ''"
            ).fetchall():
                _, key = normalize_person_name(str(existing_name))
                self.connection.execute(
                    "UPDATE people SET name_key = ? WHERE id = ?",
                    (key, int(person_id)),
                )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS face_embeddings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    person_id INTEGER NOT NULL,
                    embedding_path TEXT NOT NULL,
                    photo_path TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(person_id) REFERENCES people(id)
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS track_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    track_id INTEGER NOT NULL,
                    person_id INTEGER,
                    name TEXT,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    last_state TEXT NOT NULL,
                    max_confidence REAL DEFAULT 0,
                    FOREIGN KEY(person_id) REFERENCES people(id)
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS track_observations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    track_id INTEGER NOT NULL,
                    person_id INTEGER,
                    name TEXT,
                    state TEXT NOT NULL,
                    x1 REAL NOT NULL,
                    y1 REAL NOT NULL,
                    x2 REAL NOT NULL,
                    y2 REAL NOT NULL,
                    confidence REAL,
                    velocity_x REAL,
                    velocity_y REAL,
                    speed REAL,
                    direction_degrees REAL,
                    uncertainty REAL,
                    FOREIGN KEY(person_id) REFERENCES people(id)
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS identity_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    track_id INTEGER NOT NULL,
                    person_id INTEGER,
                    name TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    event TEXT NOT NULL,
                    FOREIGN KEY(person_id) REFERENCES people(id)
                )
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS daily_stats (
                    day TEXT PRIMARY KEY,
                    detected_count INTEGER DEFAULT 0,
                    identified_count INTEGER DEFAULT 0,
                    ghost_count INTEGER DEFAULT 0,
                    updated_at TEXT NOT NULL
                )
                """
            )
            self.connection.execute("CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)")
            self.connection.execute("CREATE INDEX IF NOT EXISTS idx_people_name ON people(name)")
            try:
                self.connection.execute(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_people_name_key ON people(name_key)"
                )
            except sqlite3.IntegrityError:
                # Preserve bancos antigos com duplicatas; o servico ainda
                # bloqueia novos nomes iguais ate que esses dados sejam revisados.
                pass
            self.connection.execute("CREATE INDEX IF NOT EXISTS idx_track_obs_track ON track_observations(track_id, timestamp)")
            self.connection.execute("CREATE INDEX IF NOT EXISTS idx_identity_person ON identity_events(person_id, timestamp)")
            self.connection.commit()

    def log_event(self, event: SystemEvent) -> None:
        ts_str = event.timestamp.isoformat(timespec="seconds")
        today = event.timestamp.strftime("%Y-%m-%d")
        with self.lock:
            self.connection.execute(
                "INSERT INTO events(timestamp, name, track_id, confidence, event, state) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    ts_str,
                    event.name,
                    event.track_id,
                    event.confidence,
                    event.event_type.value,
                    event.state,
                ),
            )
            evt_type = event.event_type.value
            det_inc = 1 if evt_type == "TARGET_CREATED" else 0
            ident_inc = 1 if evt_type == "TARGET_IDENTIFIED" else 0
            ghost_inc = 1 if evt_type == "GHOST_ACTIVATED" else 0
            if det_inc or ident_inc or ghost_inc:
                self.connection.execute(
                    """
                    INSERT INTO daily_stats(day, detected_count, identified_count, ghost_count, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(day) DO UPDATE SET
                        detected_count = detected_count + excluded.detected_count,
                        identified_count = identified_count + excluded.identified_count,
                        ghost_count = ghost_count + excluded.ghost_count,
                        updated_at = excluded.updated_at
                    """,
                    (today, det_inc, ident_inc, ghost_inc, ts_str),
                )
            self.connection.commit()

    def recent_events(self, limit: int = 20) -> List[EventRecord]:
        with self.lock:
            rows = self.connection.execute(
                "SELECT timestamp, track_id, name, confidence, event, state FROM events ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [EventRecord(str(row[0]), row[1], row[2], float(row[3] or 0.0), str(row[4]), str(row[5])) for row in rows]

    def add_person(self, name: str, photo_path: str) -> int:
        name, name_key = normalize_person_name(name)
        if not name:
            raise ValueError("O nome da pessoa nao pode ficar vazio.")
        created_at = datetime.now().isoformat(timespec="seconds")
        with self.lock:
            existing = self.connection.execute(
                "SELECT id FROM people WHERE name_key = ? LIMIT 1",
                (name_key,),
            ).fetchone()
            if existing is not None:
                raise DuplicatePersonError(
                    f"Ja existe uma pessoa com esse nome (ID {int(existing[0])})."
                )
            try:
                cursor = self.connection.execute(
                    "INSERT INTO people(name, name_key, photo_path, created_at) VALUES (?, ?, ?, ?)",
                    (name, name_key, photo_path, created_at),
                )
            except sqlite3.IntegrityError as exc:
                raise DuplicatePersonError("Ja existe uma pessoa com esse nome.") from exc
            self.connection.commit()
            return int(cursor.lastrowid)

    def add_face_embedding(self, person_id: int, embedding_path: str, photo_path: str) -> int:
        created_at = datetime.now().isoformat(timespec="seconds")
        with self.lock:
            cursor = self.connection.execute(
                "INSERT INTO face_embeddings(person_id, embedding_path, photo_path, created_at) VALUES (?, ?, ?, ?)",
                (person_id, embedding_path, photo_path, created_at),
            )
            self.connection.commit()
            return int(cursor.lastrowid)

    def clear_face_embeddings(self) -> None:
        with self.lock:
            self.connection.execute("DELETE FROM face_embeddings")
            self.connection.commit()

    def list_people(self) -> List[PersonRecord]:
        with self.lock:
            rows = self.connection.execute(
                "SELECT id, name, photo_path, created_at FROM people ORDER BY id DESC"
            ).fetchall()
        return [PersonRecord(int(row[0]), str(row[1]), str(row[2]), str(row[3])) for row in rows]

    def get_person_by_name(self, name: str) -> Optional[PersonRecord]:
        _, name_key = normalize_person_name(name)
        with self.lock:
            row = self.connection.execute(
                "SELECT id, name, photo_path, created_at FROM people WHERE name_key = ? ORDER BY id DESC LIMIT 1",
                (name_key,),
            ).fetchone()
        if row is None:
            return None
        return PersonRecord(int(row[0]), str(row[1]), str(row[2]), str(row[3]))

    def search_people(self, query: str) -> List[PersonRecord]:
        query = query.strip()
        with self.lock:
            if not query:
                rows = self.connection.execute(
                    "SELECT id, name, photo_path, created_at FROM people ORDER BY id DESC"
                ).fetchall()
            elif query.isdigit():
                rows = self.connection.execute(
                    "SELECT id, name, photo_path, created_at FROM people WHERE id = ? OR name LIKE ? ORDER BY id DESC",
                    (int(query), f"%{query}%"),
                ).fetchall()
            else:
                rows = self.connection.execute(
                    "SELECT id, name, photo_path, created_at FROM people WHERE name LIKE ? ORDER BY id DESC",
                    (f"%{query}%",),
                ).fetchall()
        return [PersonRecord(int(row[0]), str(row[1]), str(row[2]), str(row[3])) for row in rows]

    def delete_person(self, person_id: int) -> List[str]:
        """Delete a registered person and return files that should be removed from disk."""
        with self.lock:
            photo_rows = self.connection.execute(
                "SELECT photo_path FROM people WHERE id = ?",
                (person_id,),
            ).fetchall()
            embedding_rows = self.connection.execute(
                "SELECT embedding_path FROM face_embeddings WHERE person_id = ?",
                (person_id,),
            ).fetchall()
            files = [str(row[0]) for row in photo_rows] + [str(row[0]) for row in embedding_rows]

            self.connection.execute("DELETE FROM face_embeddings WHERE person_id = ?", (person_id,))
            self.connection.execute("DELETE FROM identity_events WHERE person_id = ?", (person_id,))
            self.connection.execute(
                "UPDATE track_sessions SET person_id = NULL, name = NULL WHERE person_id = ?",
                (person_id,),
            )
            self.connection.execute(
                "UPDATE track_observations SET person_id = NULL, name = NULL WHERE person_id = ?",
                (person_id,),
            )
            self.connection.execute("DELETE FROM people WHERE id = ?", (person_id,))
            self.connection.commit()
            return files

    def list_face_embeddings(self) -> List[FaceEmbeddingRecord]:
        with self.lock:
            rows = self.connection.execute(
                "SELECT id, person_id, embedding_path, photo_path, created_at FROM face_embeddings ORDER BY id DESC"
            ).fetchall()
        return [FaceEmbeddingRecord(int(row[0]), int(row[1]), str(row[2]), str(row[3]), str(row[4])) for row in rows]

    def log_identity_event(self, track_id: int, person_id: Optional[int], name: str, confidence: float, event: str) -> None:
        timestamp = datetime.now().isoformat(timespec="seconds")
        with self.lock:
            self.connection.execute(
                "INSERT INTO identity_events(timestamp, track_id, person_id, name, confidence, event) VALUES (?, ?, ?, ?, ?, ?)",
                (timestamp, track_id, person_id, name, confidence, event),
            )
            self.connection.commit()

    def upsert_track_session(self, target: TrackedTarget) -> None:
        timestamp = datetime.now().isoformat(timespec="seconds")
        with self.lock:
            row = self.connection.execute(
                "SELECT id, max_confidence FROM track_sessions WHERE track_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
                (target.track_id,),
            ).fetchone()
            if row is None:
                self.connection.execute(
                    """
                    INSERT INTO track_sessions(track_id, person_id, name, started_at, last_state, max_confidence)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (target.track_id, target.person_id, target.name, timestamp, target.state.value, target.confidence),
                )
            else:
                self.connection.execute(
                    """
                    UPDATE track_sessions
                    SET person_id = COALESCE(?, person_id),
                        name = COALESCE(?, name),
                        last_state = ?,
                        max_confidence = MAX(max_confidence, ?)
                    WHERE id = ?
                    """,
                    (target.person_id, target.name, target.state.value, target.confidence, int(row[0])),
                )
            self.connection.commit()

    def close_track_session(self, track_id: int, state: str) -> None:
        timestamp = datetime.now().isoformat(timespec="seconds")
        with self.lock:
            self.connection.execute(
                "UPDATE track_sessions SET ended_at = ?, last_state = ? WHERE track_id = ? AND ended_at IS NULL",
                (timestamp, state, track_id),
            )
            self.connection.commit()

    def log_track_observations(self, targets: Sequence[TrackedTarget]) -> None:
        if not targets:
            return
        timestamp = datetime.now().isoformat(timespec="seconds")
        rows = [
            (
                timestamp,
                target.track_id,
                target.person_id,
                target.name,
                target.state.value,
                target.bbox.x1,
                target.bbox.y1,
                target.bbox.x2,
                target.bbox.y2,
                target.confidence,
                target.velocity_x,
                target.velocity_y,
                target.speed,
                target.direction_degrees,
                target.uncertainty,
            )
            for target in targets
        ]
        with self.lock:
            self.connection.executemany(
                """
                INSERT INTO track_observations(
                    timestamp, track_id, person_id, name, state, x1, y1, x2, y2,
                    confidence, velocity_x, velocity_y, speed, direction_degrees, uncertainty
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            self.connection.commit()

    def person_history(self, person_id: int, limit: int = 80) -> List[EventRecord]:
        with self.lock:
            rows = self.connection.execute(
                """
                SELECT timestamp, track_id, name, confidence, event, 'IDENTITY'
                FROM identity_events
                WHERE person_id = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (person_id, limit),
            ).fetchall()
        return [EventRecord(str(row[0]), row[1], row[2], float(row[3] or 0.0), str(row[4]), str(row[5])) for row in rows]

    def stats_summary(self) -> dict[str, int]:
        today = datetime.now().strftime("%Y-%m-%d")
        with self.lock:
            people_count = self.connection.execute("SELECT COUNT(*) FROM people").fetchone()[0]
            identity_count = self.connection.execute("SELECT COUNT(*) FROM identity_events").fetchone()[0]
            ghost_count = self.connection.execute("SELECT COUNT(*) FROM events WHERE event = 'GHOST_ACTIVATED'").fetchone()[0]
            session_count = self.connection.execute("SELECT COUNT(*) FROM track_sessions").fetchone()[0]
            today_row = self.connection.execute(
                "SELECT detected_count, identified_count, ghost_count FROM daily_stats WHERE day = ?",
                (today,),
            ).fetchone()

        today_detected = int(today_row[0]) if today_row else 0
        today_identified = int(today_row[1]) if today_row else 0
        today_ghost = int(today_row[2]) if today_row else 0

        return {
            "people": int(people_count),
            "identity_events": int(identity_count),
            "ghost_events": int(ghost_count),
            "track_sessions": int(session_count),
            "today_detected": today_detected,
            "today_identified": today_identified,
            "today_ghost": today_ghost,
        }

    def close(self) -> None:
        with self.lock:
            self.connection.close()
