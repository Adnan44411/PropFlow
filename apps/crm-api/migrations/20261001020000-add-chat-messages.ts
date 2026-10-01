import type { MigrationFn } from 'umzug';
import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

export const up: MigrationFn<QueryInterface> = async ({ context: queryInterface }) => {
  const tables = await queryInterface.showAllTables();

  if (!tables.includes('chat_messages')) {
    await queryInterface.createTable('chat_messages', {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },

      tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      property_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      sender_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      client_msg_id: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },

      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });

    await queryInterface.addConstraint('chat_messages', {
      fields: ['property_id', 'client_msg_id'],
      type: 'unique',
      name: 'uq_chat_property_client_msg',
    });

    await queryInterface.addIndex('chat_messages', ['property_id', 'id'], {
      name: 'idx_chat_property_id',
    });
  }
};

export const down: MigrationFn<QueryInterface> = async ({ context: queryInterface }) => {
  const tables = await queryInterface.showAllTables();

  if (tables.includes('chat_messages')) {
    await queryInterface.dropTable('chat_messages');
  }
};
