import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

/**
 * Column types are spelled out on every decorator instead of inferred from
 * the TypeScript type: `tsx` and Vitest compile through esbuild, which
 * doesn't emit the `design:type` metadata TypeORM would otherwise infer
 * them from.
 */
@Entity({ name: "notes" })
export class Note {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** What `owner("user_id")` in pgaccess.config.ts compares against the caller's id. */
  @Column("uuid", { name: "user_id" })
  userId!: string;

  @Column("text")
  body!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
