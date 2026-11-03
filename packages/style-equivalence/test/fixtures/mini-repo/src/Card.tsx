import styles from './Card.module.css';

export const Card = ({ active }: { active: boolean }) => (
  <div className={active ? `${styles.card} ${styles.active}` : styles.card}>
    <span className={styles.title}>Card</span>
  </div>
);
