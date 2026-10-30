import { Inject, Injectable } from '@nestjs/common';
import {
  activities,
  and,
  desc,
  eq,
  profiles,
  sql,
  withUserContext,
  type Database,
  type JwtClaims,
  type SQL,
} from '@astrum/db';
import { DATABASE } from '../database/database.module.js';
import type { WorkspaceContext } from '../http/request.js';
import type { TimelineInput } from './crm.schemas.js';
import { afterCursor, decodeCursor, encodeCursor } from './pagination.js';

/** Linha do tempo de um contato, negócio ou empresa (mais recente primeiro). */
@Injectable()
export class TimelineService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  list(user: JwtClaims, ws: WorkspaceContext, input: TimelineInput) {
    return withUserContext(this.db, user, async (tx) => {
      const where: SQL[] = [eq(activities.workspaceId, ws.id)];
      if (input.contact) where.push(eq(activities.contactId, input.contact));
      if (input.deal) where.push(eq(activities.dealId, input.deal));
      if (input.company) where.push(eq(activities.companyId, input.company));
      if (input.cursor) where.push(afterCursor(activities.occurredAt, activities.id, decodeCursor(input.cursor)));

      const rows = await tx
        .select({
          id: activities.id,
          type: activities.type,
          contactId: activities.contactId,
          dealId: activities.dealId,
          companyId: activities.companyId,
          actorId: activities.actorId,
          actorName: sql<string | null>`coalesce(${profiles.name}, ${profiles.email})`,
          payload: activities.payload,
          occurredAt: activities.occurredAt,
        })
        .from(activities)
        .leftJoin(profiles, eq(profiles.id, activities.actorId))
        .where(and(...where))
        .orderBy(desc(activities.occurredAt), desc(activities.id))
        .limit(input.limit + 1);

      const items = rows.slice(0, input.limit);
      const last = items.at(-1);
      return {
        items,
        nextCursor: rows.length > input.limit && last ? encodeCursor({ createdAt: last.occurredAt, id: last.id }) : null,
      };
    });
  }
}
