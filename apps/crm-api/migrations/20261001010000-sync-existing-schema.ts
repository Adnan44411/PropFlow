import { DataTypes, QueryInterface } from 'sequelize';

type Ctx = { context: QueryInterface };

export async function up({ context: qi }: Ctx): Promise<void> {
  /*
   * IMPORTANT:
   * This migration is designed for the EXISTING crm_db.
   * It does not drop or recreate any tables.
   */

  // ------------------------------------------------------------
  // properties
  // ------------------------------------------------------------

  const properties = await qi.describeTable('properties');

  if (!properties.is_stale) {
    await qi.addColumn('properties', 'is_stale', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  }

  if (!properties.last_activity_at) {
    await qi.addColumn('properties', 'last_activity_at', {
      type: DataTypes.DATE,
      allowNull: true,
    });

    await qi.sequelize.query(`
      UPDATE properties
      SET last_activity_at = COALESCE(updatedAt, NOW())
      WHERE last_activity_at IS NULL
    `);

    await qi.changeColumn('properties', 'last_activity_at', {
      type: DataTypes.DATE,
      allowNull: false,
    });
  }

  // ------------------------------------------------------------
  // site_visits
  // ------------------------------------------------------------

  const siteVisits = await qi.describeTable('site_visits');

  if (!siteVisits.agent_id) {
    await qi.addColumn('site_visits', 'agent_id', {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    });

    /*
     * Existing records use created_by as the closest existing
     * assignment/agent field.
     */
    await qi.sequelize.query(`
      UPDATE site_visits
      SET agent_id = created_by
      WHERE agent_id IS NULL
    `);
  }

  if (!siteVisits.visit_at_utc) {
    await qi.addColumn('site_visits', 'visit_at_utc', {
      type: DataTypes.DATE,
      allowNull: true,
    });

    /*
     * Existing scheduled_at values are stored with Asia/Kolkata
     * timezone context. For existing data, preserve the timestamp
     * value rather than changing the actual appointment time.
     */
    await qi.sequelize.query(`
      UPDATE site_visits
      SET visit_at_utc = scheduled_at
      WHERE visit_at_utc IS NULL
    `);
  }

  if (!siteVisits.duration_minutes) {
    await qi.addColumn('site_visits', 'duration_minutes', {
      type: DataTypes.SMALLINT.UNSIGNED,
      allowNull: false,
      defaultValue: 60,
    });
  }

  if (!siteVisits.outcome) {
    await qi.addColumn('site_visits', 'outcome', {
      type: DataTypes.ENUM(
        'SCHEDULED',
        'COMPLETED',
        'NO_SHOW',
        'CANCELLED',
        'INTERESTED',
        'NOT_INTERESTED',
      ),
      allowNull: true,
    });

    /*
     * Convert the existing lowercase status values to the
     * application's uppercase outcome values.
     */
    await qi.sequelize.query(`
      UPDATE site_visits
      SET outcome = CASE status
        WHEN 'scheduled' THEN 'SCHEDULED'
        WHEN 'completed' THEN 'COMPLETED'
        WHEN 'cancelled' THEN 'CANCELLED'
        WHEN 'no_show' THEN 'NO_SHOW'
        ELSE 'SCHEDULED'
      END
      WHERE outcome IS NULL
    `);

    await qi.changeColumn('site_visits', 'outcome', {
      type: DataTypes.ENUM(
        'SCHEDULED',
        'COMPLETED',
        'NO_SHOW',
        'CANCELLED',
        'INTERESTED',
        'NOT_INTERESTED',
      ),
      allowNull: false,
      defaultValue: 'SCHEDULED',
    });
  }

  if (!siteVisits.reminded_at) {
    await qi.addColumn('site_visits', 'reminded_at', {
      type: DataTypes.DATE,
      allowNull: true,
    });
  }

  /*
   * The new application fields are now available.
   * Existing data remains intact.
   */
}

export async function down({ context: qi }: Ctx): Promise<void> {
  /*
   * Intentionally conservative rollback.
   *
   * We do NOT automatically remove columns because this migration
   * upgrades an existing production-like database and removing
   * columns could destroy application data.
   */
}
