import { DataTypes, QueryInterface } from 'sequelize';

type Ctx = { context: QueryInterface };

async function hasColumn(
  qi: QueryInterface,
  table: string,
  column: string,
): Promise<boolean> {
  const description = await qi.describeTable(table);
  return Boolean(description[column]);
}

async function hasTable(
  qi: QueryInterface,
  table: string,
): Promise<boolean> {
  const tables = await qi.showAllTables();

  return tables.some(
    (name) => String(name).toLowerCase() === table.toLowerCase(),
  );
}

async function hasIndex(
  qi: QueryInterface,
  table: string,
  indexName: string,
): Promise<boolean> {
  const [rows] = await qi.sequelize.query(
    `SHOW INDEX FROM \`${table}\` WHERE Key_name = :indexName`,
    {
      replacements: { indexName },
    },
  );

  return Array.isArray(rows) && rows.length > 0;
}

export async function up({ context: qi }: Ctx): Promise<void> {
  /*
   * IMPORTANT
   * ----------
   * This is a compatibility migration for the EXISTING auth_db.
   *
   * Existing tables:
   *   tenants
   *   users
   *   invitations
   *
   * are preserved.
   *
   * We only add the columns/tables required by the current
   * Auth Server implementation.
   */

  // ============================================================
  // TENANTS
  // ============================================================

  if (!(await hasColumn(qi, 'tenants', 'isActive'))) {
    await qi.addColumn('tenants', 'isActive', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  }

  // ============================================================
  // USERS
  // ============================================================

  /*
   * Existing users table already contains:
   *
   *   id
   *   email
   *   passwordHash
   *   firstName
   *   lastName
   *   role
   *   createdAt
   *   updatedAt
   *   tenant_id
   *   numeric_id
   *
   * The current Auth Server uses:
   *
   *   id
   *   tenantId
   *   email
   *   name
   *   passwordHash
   *   role
   *   isActive
   *   lastLoginAt
   */

  if (!(await hasColumn(qi, 'users', 'name'))) {
    await qi.addColumn('users', 'name', {
      type: DataTypes.STRING(120),
      allowNull: false,
      defaultValue: '',
    });

    /*
     * Preserve the existing firstName/lastName information.
     */
    await qi.sequelize.query(`
      UPDATE users
      SET name = TRIM(
        CONCAT(
          COALESCE(firstName, ''),
          ' ',
          COALESCE(lastName, '')
        )
      )
      WHERE name = ''
    `);
  }

  if (!(await hasColumn(qi, 'users', 'isActive'))) {
    await qi.addColumn('users', 'isActive', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  }

  if (!(await hasColumn(qi, 'users', 'lastLoginAt'))) {
    await qi.addColumn('users', 'lastLoginAt', {
      type: DataTypes.DATE,
      allowNull: true,
    });
  }

  /*
   * Index used by Auth Server user administration queries.
   *
   * Existing users table uses tenant_id, while the new
   * isActive column is camelCase.
   */
  if (!(await hasIndex(qi, 'users', 'users_tenant_role_active'))) {
    await qi.addIndex('users', ['tenant_id', 'role', 'isActive'], {
      name: 'users_tenant_role_active',
    });
  }

  // ============================================================
  // INVITES
  // ============================================================

  /*
   * DO NOT touch the existing "invitations" table.
   *
   * It belongs to the older schema and contains historical data.
   *
   * The current Auth Server uses a separate "invites" table.
   */

  if (!(await hasTable(qi, 'invites'))) {
    await qi.createTable('invites', {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },

      /*
       * Existing tenants.id is an UNSIGNED INT.
       *
       * Therefore this MUST be INTEGER.UNSIGNED,
       * otherwise MySQL rejects the foreign key.
       */
      tenantId: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        references: {
          model: 'tenants',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },

      email: {
        type: DataTypes.STRING(190),
        allowNull: false,
      },

      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },

      role: {
        type: DataTypes.ENUM(
          'ADMIN',
          'MANAGER',
          'AGENT',
        ),
        allowNull: false,
      },

      /*
       * These are logical numeric user IDs.
       * They correspond to the existing users.numeric_id.
       *
       * No FK is added here because users has UUID primary key "id"
       * while Auth Server uses numeric_id as its logical ID.
       */
      invitedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },

      acceptedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      acceptedUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },

      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    await qi.addIndex('invites', ['tenantId', 'email'], {
      name: 'invites_tenant_email',
    });
  }

  // ============================================================
  // SIGNING KEYS
  // ============================================================

  /*
   * Auth Server requires this table during startup.
   *
   * It stores the public/private signing key information used
   * for RS256 JWT tokens.
   */

  if (!(await hasTable(qi, 'signing_keys'))) {
    await qi.createTable('signing_keys', {
      kid: {
        type: DataTypes.STRING(64),
        primaryKey: true,
      },

      alg: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'RS256',
      },

      publicPem: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      privateEnc: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      source: {
        type: DataTypes.ENUM(
          'env',
          'rotated',
        ),
        allowNull: false,
      },

      retiredAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },

      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });
  }

  // ============================================================
  // SECURITY EVENTS
  // ============================================================

  /*
   * Stores authentication/security audit events.
   */

  if (!(await hasTable(qi, 'security_events'))) {
    await qi.createTable('security_events', {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },

      type: {
        type: DataTypes.STRING(40),
        allowNull: false,
      },

      severity: {
        type: DataTypes.ENUM(
          'INFO',
          'WARN',
          'CRITICAL',
        ),
        allowNull: false,
      },

      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      tenantId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      ip: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },

      userAgent: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      requestId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },

      meta: {
        type: DataTypes.JSON,
        allowNull: true,
      },

      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    await qi.addIndex(
      'security_events',
      ['createdAt'],
      {
        name: 'security_events_created',
      },
    );

    await qi.addIndex(
      'security_events',
      ['tenantId', 'createdAt'],
      {
        name: 'security_events_tenant_created',
      },
    );
  }
}

export async function down({ context: qi }: Ctx): Promise<void> {
  /*
   * IMPORTANT
   * ----------
   * Existing users, tenants and invitations are NEVER removed.
   */

  if (await hasTable(qi, 'security_events')) {
    await qi.dropTable('security_events');
  }

  if (await hasTable(qi, 'signing_keys')) {
    await qi.dropTable('signing_keys');
  }

  if (await hasTable(qi, 'invites')) {
    await qi.dropTable('invites');
  }

  /*
   * Remove only columns added by this migration.
   */

  if (await hasColumn(qi, 'users', 'lastLoginAt')) {
    await qi.removeColumn('users', 'lastLoginAt');
  }

  if (await hasColumn(qi, 'users', 'isActive')) {
    await qi.removeColumn('users', 'isActive');
  }

  if (await hasColumn(qi, 'users', 'name')) {
    await qi.removeColumn('users', 'name');
  }

  if (await hasColumn(qi, 'tenants', 'isActive')) {
    await qi.removeColumn('tenants', 'isActive');
  }
}