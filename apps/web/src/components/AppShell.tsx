import { navFor, type NavItem } from '../routing/roleConfig';

import { useState } from 'react';
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  AppBar,
  Typography,
  IconButton,
  Avatar,
  Menu,
  MenuItem,
  Chip,
} from '@mui/material';

import {
  Dashboard,
  HomeWork,
  CalendarMonth,
  People,
  Settings,
  Apartment,
  Menu as MenuIcon,
  Logout,
  Security,
} from '@mui/icons-material';

import {
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import {
  useSelector,
  useDispatch,
} from 'react-redux';

import type { RootState } from '../app/store';
import { logout } from '../app/store';
// import { navFor } from '../routing/roleConfig';

const icons: any = {
  Dashboard,
  Properties: HomeWork,
  Calendar: CalendarMonth,
  Users: People,
  'Master Data': Settings,
  Tenants: Apartment,
  Security,
};

export function AppShell() {
  const [mobile, setMobile] = useState(false);
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);

  const user = useSelector((s: RootState) => s.auth.user)!;
  const dispatch = useDispatch();

  // useNavigate() returns a function, so call it "navigate"
  const navigate = useNavigate();

  const loc = useLocation();

  // Get the navigation items for the logged-in user's role
  const navigationItems = navFor(user.role);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>

      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          borderBottom: '1px solid #e2e8f0',
          zIndex: (t) => t.zIndex.drawer + 1,
        }}
      >
        <Toolbar>

          <IconButton
            sx={{ display: { md: 'none' } }}
            onClick={() => setMobile(true)}
          >
            <MenuIcon />
          </IconButton>

          <Typography
            variant="h6"
            sx={{
              fontWeight: 900,
              color: 'primary.main',
              mr: 2,
            }}
          >
            PropFlow
          </Typography>

          <Typography
            sx={{
              display: { xs: 'none', md: 'block' },
              color: 'text.secondary',
            }}
          >
            {user.tenantName || 'Platform Console'}
          </Typography>

          <Box sx={{ flex: 1 }} />

          <Chip
            size="small"
            label={user.role.replace('_', ' ')}
            sx={{
              mr: 2,
              display: { xs: 'none', sm: 'flex' },
            }}
          />

          <IconButton onClick={(e) => setAnchor(e.currentTarget)}>
            <Avatar sx={{ width: 34, height: 34 }}>
              {user.name[0]}
            </Avatar>
          </IconButton>

          <Menu
            anchorEl={anchor}
            open={!!anchor}
            onClose={() => setAnchor(null)}
          >
            <MenuItem
              onClick={() => {
                dispatch(logout());
                navigate('/login');
              }}
            >
              <Logout fontSize="small" sx={{ mr: 1 }} />
              Logout
            </MenuItem>
          </Menu>

        </Toolbar>
      </AppBar>

      {/* Desktop Sidebar */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          width: 245,
          '& .MuiDrawer-paper': {
            width: 245,
            boxSizing: 'border-box',
            borderRight: '1px solid #e2e8f0',
          },
        }}
      >
        <Toolbar />

        <Sidebar
          nav={navigationItems}
          loc={loc.pathname}
        />
      </Drawer>

      {/* Mobile Sidebar */}
      <Drawer
        open={mobile}
        onClose={() => setMobile(false)}
        sx={{
          '& .MuiDrawer-paper': {
            width: 245,
          },
        }}
      >
        <Toolbar />

        <Sidebar
          nav={navigationItems}
          loc={loc.pathname}
          close={() => setMobile(false)}
        />
      </Drawer>

      <Box
        component="main"
        sx={{
          flex: 1,
          p: { xs: 2, md: 3 },
          pt: { xs: 10, md: 11 },
          minWidth: 0,
        }}
      >
        <Outlet />
      </Box>

    </Box>
  );
}

function Sidebar({
  nav,
  loc,
  close = () => {},
}: {
  nav: NavItem[];
  loc: string;
  close?: () => void;
}) {
  const navigate = useNavigate();

  return (
    <List sx={{ p: 1.5 }}>
      {nav.map(([label, path]) => {
        const I = icons[label] || HomeWork;

        return (
          <ListItemButton
            key={path}
            selected={loc.startsWith(path)}
            onClick={() => {
              navigate(path);
              close();
            }}
            sx={{
              borderRadius: 2,
              mb: 0.5,
            }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>
              <I fontSize="small" />
            </ListItemIcon>

            <ListItemText primary={label} />
          </ListItemButton>
        );
      })}
    </List>
  );
}

