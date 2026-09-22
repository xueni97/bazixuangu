import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomePage.vue'),
  },
  {
    path: '/daily',
    name: 'daily',
    component: () => import('../views/DailyPage.vue'),
  },
  {
    path: '/weekly',
    name: 'weekly',
    component: () => import('../views/WeeklyPage.vue'),
  },
  {
    path: '/monthly',
    name: 'monthly',
    component: () => import('../views/MonthlyPage.vue'),
  },
  {
    path: '/buy-point',
    name: 'buyPoint',
    component: () => import('../views/BuyPointPage.vue'),
  },
  {
    path: '/scan',
    name: 'scan',
    component: () => import('../views/ScanPage.vue'),
  },
  {
    path: '/watchlist',
    name: 'watchlist',
    component: () => import('../views/WatchlistPage.vue'),
  },
  {
    path: '/backtest',
    name: 'backtest',
    component: () => import('../views/BacktestPage.vue'),
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
