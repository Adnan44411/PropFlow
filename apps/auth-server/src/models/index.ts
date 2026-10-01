import {
  CreationOptional,
  DataTypes,
  ForeignKey,
  NonAttribute,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize';
import type { Role } from '@propflow/shared';
import { sequelize } from '../lib/db';

export class Tenant extends Model<
  InferAttributes<Tenant>,
  InferCreationAttributes<Tenant>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare slug: string;
  declare isActive: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Tenant.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
      field: 'id',
    },

    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },

    slug: {
      type: DataTypes.STRING(60),
      allowNull: false,
      unique: true,
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'isActive',
    },

    createdAt: {
      type: DataTypes.DATE,
      field: 'createdAt',
    },

    updatedAt: {
      type: DataTypes.DATE,
      field: 'updatedAt',
    },
  },
  {
    sequelize,
    tableName: 'tenants',
  },
);

export class User extends Model<
  InferAttributes<User>,
  InferCreationAttributes<User>
> {
  /*
   * Application-level user ID.
   * This maps to auth_db.users.numeric_id and must remain numeric
   * because the rest of auth-server/shared events use numeric user IDs.
   */
  declare id: CreationOptional<number>;

  /*
   * Actual UUID primary key stored in users.id.
   */
declare uuid: CreationOptional<string>;
declare firstName: CreationOptional<string>;
declare lastName: CreationOptional<string>;
  declare tenantId: ForeignKey<number> | null;
  declare email: string;

  /*
   * These columns exist in the DB and are NOT NULL.
   * They are derived from `name` when needed.
   */

  declare name: string;
  declare passwordHash: string;
  declare role: Role;
  declare isActive: CreationOptional<boolean>;
  declare lastLoginAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  toPublic() {
    return {
      id: this.id,
      uuid: this.uuid,
      tenantId: this.tenantId ?? null,
      email: this.email,
      firstName: this.firstName,
      lastName: this.lastName,
      name: this.name,
      role: this.role,
      isActive: this.isActive,
      lastLoginAt: this.lastLoginAt ?? null,
      createdAt: this.createdAt,
    };
  }
}

User.init(
  {
    /*
     * Application ID -> numeric_id
     */
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      unique: true,
      autoIncrement: true,
      field: 'numeric_id',
    },

    /*
     * Real database UUID primary key -> id
     */
    uuid: {
      type: DataTypes.UUID,
      allowNull: false,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
      field: 'id',
    },

    tenantId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: 'tenant_id',
    },

    email: {
      type: DataTypes.STRING(190),
      allowNull: false,
      unique: true,
      field: 'email',
    },

    firstName: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: 'firstName',
    },

    lastName: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: 'lastName',
    },

    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
      field: 'name',
    },

    passwordHash: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'passwordHash',
    },

    role: {
      type: DataTypes.ENUM(
        'SUPER_ADMIN',
        'ADMIN',
        'MANAGER',
        'AGENT',
      ),
      allowNull: false,
      field: 'role',
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'isActive',
    },

    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'lastLoginAt',
    },

    createdAt: {
      type: DataTypes.DATE,
      field: 'createdAt',
    },

    updatedAt: {
      type: DataTypes.DATE,
      field: 'updatedAt',
    },
  },
  {
    sequelize,
    tableName: 'users',

    hooks: {
      beforeValidate: (user) => {
        if (!user.firstName || !user.lastName) {
          const parts = user.name.trim().split(/\s+/);

          user.firstName = parts[0] || user.name;
          user.lastName =
            parts.slice(1).join(' ') || user.firstName;
        }
      },
    },
  },
);

export class Invite extends Model<
  InferAttributes<Invite>,
  InferCreationAttributes<Invite>
> {
  declare id: CreationOptional<number>;
  declare tenantId: number;
  declare email: string;
  declare name: string;
  declare role: Role;
  declare invitedBy: number | null;
  declare expiresAt: Date;
  declare acceptedAt: CreationOptional<Date | null>;
  declare revokedAt: CreationOptional<Date | null>;
  declare acceptedUserId: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  get state(): NonAttribute<
    'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
  > {
    if (this.acceptedAt) return 'ACCEPTED';
    if (this.revokedAt) return 'REVOKED';
    if (this.expiresAt.getTime() < Date.now()) return 'EXPIRED';

    return 'PENDING';
  }

  toPublic() {
    return {
      id: this.id,
      tenantId: this.tenantId,
      email: this.email,
      name: this.name,
      role: this.role,
      invitedBy: this.invitedBy,
      expiresAt: this.expiresAt,
      acceptedAt: this.acceptedAt ?? null,
      revokedAt: this.revokedAt ?? null,
      state: this.state,
      createdAt: this.createdAt,
    };
  }
}

Invite.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
      field: 'id',
    },

    tenantId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: 'tenantId',
    },

    email: {
      type: DataTypes.STRING(190),
      allowNull: false,
      field: 'email',
    },

    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
      field: 'name',
    },

    role: {
      type: DataTypes.ENUM(
        'ADMIN',
        'MANAGER',
        'AGENT',
      ),
      allowNull: false,
      field: 'role',
    },

    invitedBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: 'invitedBy',
    },

    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'expiresAt',
    },

    acceptedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'acceptedAt',
    },

    revokedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'revokedAt',
    },

    acceptedUserId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: 'acceptedUserId',
    },

    createdAt: {
      type: DataTypes.DATE,
      field: 'createdAt',
    },

    updatedAt: {
      type: DataTypes.DATE,
      field: 'updatedAt',
    },
  },
  {
    sequelize,
    tableName: 'invites',
  },
);

export class SigningKey extends Model<
  InferAttributes<SigningKey>,
  InferCreationAttributes<SigningKey>
> {
  declare kid: string;
  declare alg: CreationOptional<string>;
  declare publicPem: string;

  /** AES-256-GCM encrypted PEM; null for the bootstrap key that lives only in env. */
  declare privateEnc: string | null;

  declare source: 'env' | 'rotated';
  declare retiredAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SigningKey.init(
  {
    kid: {
      type: DataTypes.STRING(64),
      primaryKey: true,
      field: 'kid',
    },

    alg: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'RS256',
      field: 'alg',
    },

    publicPem: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: 'publicPem',
    },

    privateEnc: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'privateEnc',
    },

    source: {
      type: DataTypes.ENUM('env', 'rotated'),
      allowNull: false,
      field: 'source',
    },

    retiredAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'retiredAt',
    },

    createdAt: {
      type: DataTypes.DATE,
      field: 'createdAt',
    },

    updatedAt: {
      type: DataTypes.DATE,
      field: 'updatedAt',
    },
  },
  {
    sequelize,
    tableName: 'signing_keys',
  },
);

export type SecurityEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGIN_LOCKED'
  | 'REFRESH_REUSE_DETECTED'
  | 'LOGOUT'
  | 'LOGOUT_ALL'
  | 'KEY_ROTATED'
  | 'TENANT_CREATED'
  | 'INVITE_CREATED'
  | 'INVITE_ACCEPTED'
  | 'USER_UPDATED';

export class SecurityEvent extends Model<
  InferAttributes<SecurityEvent>,
  InferCreationAttributes<SecurityEvent>
> {
  declare id: CreationOptional<number>;
  declare type: SecurityEventType;
  declare severity: 'INFO' | 'WARN' | 'CRITICAL';
  declare userId: number | null;
  declare tenantId: number | null;
  declare ip: string | null;
  declare userAgent: string | null;
  declare requestId: string | null;
  declare meta: Record<string, unknown> | null;
  declare createdAt: CreationOptional<Date>;
}

SecurityEvent.init(
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
      field: 'id',
    },

    type: {
      type: DataTypes.STRING(40),
      allowNull: false,
      field: 'type',
    },

    severity: {
      type: DataTypes.ENUM(
        'INFO',
        'WARN',
        'CRITICAL',
      ),
      allowNull: false,
      field: 'severity',
    },

    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: 'userId',
    },

    tenantId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: 'tenantId',
    },

    ip: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: 'ip',
    },

    userAgent: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'userAgent',
    },

    requestId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: 'requestId',
    },

    meta: {
      type: DataTypes.JSON,
      allowNull: true,
      field: 'meta',
    },

    createdAt: {
      type: DataTypes.DATE,
      field: 'createdAt',
    },
  },
  {
    sequelize,
    tableName: 'security_events',
    updatedAt: false,
  },
);

Tenant.hasMany(User, {
  foreignKey: 'tenantId',
});

User.belongsTo(Tenant, {
  foreignKey: 'tenantId',
});

Tenant.hasMany(Invite, {
  foreignKey: 'tenantId',
});

Invite.belongsTo(Tenant, {
  foreignKey: 'tenantId',
});

export { sequelize };